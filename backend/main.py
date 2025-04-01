import os
import tempfile
import subprocess
import shutil
import logging
import re # Import regular expression module
from typing import Dict, List, Optional, Set

from fastapi import FastAPI, File, Form, UploadFile, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# --- Configuration ---
ADDR2LINE_PATH = shutil.which("addr2line") # Find addr2line in PATH
MAX_FILE_SIZE = 100 * 1024 * 1024  # Max 100 MB ELF file
MAX_LOG_SIZE = 5 * 1024 * 1024     # Max 5 MB log text input
MAX_ADDRESSES_TO_RESOLVE = 5000     # Limit distinct addresses sent to addr2line
PROCESS_TIMEOUT = 30 # Increased timeout slightly for potentially more addresses

# Prioritize 8-hex-digit addresses (no trailing boundary check)
# Then match other common lengths (6-7, 9-16) ONLY if followed by a word boundary
ADDRESS_REGEX = re.compile(
    r"(?:"                          # Start NON-CAPTURING group for 8-digit
    r"\b0x[0-9a-fA-F]{8}"
    r")"
    r"|(?:"                         # OR - Start NON-CAPTURING group for 6-7 digit
    r"\b0x[0-9a-fA-F]{6,7}\b"
    r")"
    r"|(?:"                         # OR - Start NON-CAPTURING group for 9-16 digit
    r"\b0x[0-9a-fA-F]{9,16}\b"
    r")"
)
# Note: This regex uses capturing groups, but findall/sub will still work correctly
# findall will return a list of strings corresponding to the *entire* match found
# (e.g., "0x2003ffe0", "0xabcdef", "0x1122334455667788") because the | operator
# makes the engine return the whole text matched by whichever alternative succeeded.

# --- Logging Setup ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# --- Response Model ---
class ResolveLogResponse(BaseModel):
    resolved_log: str = Field(..., description="The original log text with addresses replaced by resolved locations.")
    addresses_found: int = Field(..., description="Total number of unique addresses found and attempted to resolve.")
    addresses_resolved: int = Field(..., description="Number of unique addresses successfully resolved by addr2line.")


# --- Helper Function to run addr2line ---
def run_addr2line(elf_path: str, addresses: List[str]) -> subprocess.CompletedProcess:
    """Executes addr2line securely and returns the process result."""
    if not ADDR2LINE_PATH:
        logger.error("addr2line command not found on server.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Addr2line utility not available on the server.",
        )
    if not addresses: # Don't run if no addresses provided
        # Return a dummy completed process object
        return subprocess.CompletedProcess(args=[], returncode=0, stdout="", stderr="")


    command = [ADDR2LINE_PATH, '-e', elf_path, '-f', '-C'] + addresses
    # Avoid logging potentially huge command if addresses list is massive
    logger.info(f"Running addr2line for {len(addresses)} unique addresses using {elf_path}: {addresses}")

    try:
        process = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False, # Handle non-zero exit manually
            timeout=PROCESS_TIMEOUT
        )
        return process
    except FileNotFoundError:
        logger.error(f"addr2line command not found at path: {ADDR2LINE_PATH}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Addr2line utility not found.",
        )
    except subprocess.TimeoutExpired:
        logger.error(f"addr2line command timed out after {PROCESS_TIMEOUT} seconds.")
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT, # 504 appropriate for upstream timeout
            detail=f"Processing timed out after {PROCESS_TIMEOUT} seconds.",
        )
    except Exception as e: # Catch potential other subprocess errors
        logger.error(f"Subprocess execution failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to execute addr2line process.",
        )


# --- FastAPI App ---
app = FastAPI(
    title="Addr2Line Log Resolver Service",
    description="Accepts log text and an ELF file, resolves addresses within the log, and returns the modified log.",
    version="1.3.0"
)

# Update CORS configuration to allow your frontend origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5500", "http://localhost:5500"],  # Add your frontend origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"]
)

# --- API Endpoint ---
@app.post("/resolve_log",
          response_model=ResolveLogResponse,
          summary="Resolve addresses within log text using an ELF file",
          responses={
              status.HTTP_400_BAD_REQUEST: {"description": "Invalid input (file/log missing, size limits exceeded)"},
              status.HTTP_413_REQUEST_ENTITY_TOO_LARGE: {"description": f"Input exceeds size limit (ELF: {MAX_FILE_SIZE} bytes, Log: {MAX_LOG_SIZE} bytes)"},
              status.HTTP_500_INTERNAL_SERVER_ERROR: {"description": "Server error (addr2line not found or execution failed)"},
              status.HTTP_504_GATEWAY_TIMEOUT: {"description": f"Processing timed out (> {PROCESS_TIMEOUT}s)"},
          })
async def resolve_log_addresses(
    elf_file: UploadFile = File(..., description="The ELF file containing debug symbols."),
    log_text: str = Form(..., description="The log text containing addresses to resolve.")
):
    """
    Upload an ELF file and log text. Addresses (like 0x...) found in the log
    will be replaced with their resolved function name, source file, and line number.
    """
    temp_file_path = None
    resolved_count = 0

    # --- Security: Validate Input Sizes ---
    if elf_file.size is not None and elf_file.size > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"ELF file exceeds size limit ({MAX_FILE_SIZE} bytes)."
        )
    if len(log_text.encode('utf-8')) > MAX_LOG_SIZE: # Check byte size for consistency
         raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Log text exceeds size limit ({MAX_LOG_SIZE} bytes)."
        )
    if not log_text:
        logger.info("Received empty log text.")
        # Return original empty text, indicate 0 found/resolved
        return ResolveLogResponse(resolved_log="", addresses_found=0, addresses_resolved=0)


    try:
        # --- Extract Unique Addresses ---
        # findall with this regex pattern will return the full matched string
        # regardless of which alternative capture group matched it.
        found_addresses: Set[str] = set(ADDRESS_REGEX.findall(log_text))
        unique_addresses: List[str] = sorted(list(found_addresses)) # Sort for consistent addr2line input/output order
        num_unique_addresses = len(unique_addresses)
        logger.info(f"Found {num_unique_addresses} unique potential addresses.")

        if num_unique_addresses == 0:
            logger.info("No addresses found matching the pattern.")
            # Return original text if no addresses need resolving
            return ResolveLogResponse(
                resolved_log=log_text,
                addresses_found=0,
                addresses_resolved=0
            )

        if num_unique_addresses > MAX_ADDRESSES_TO_RESOLVE:
             logger.warning(f"Found {num_unique_addresses} unique addresses, exceeding limit of {MAX_ADDRESSES_TO_RESOLVE}. Truncating list.")
             unique_addresses = unique_addresses[:MAX_ADDRESSES_TO_RESOLVE]
             # Consider if we should error out or just process the limited set. Let's process the limited set.


        # --- Prepare and Write Temp ELF File ---
        # Read the file content (consider chunked reading for very large valid files)
        file_data = await elf_file.read()
        if len(file_data) > MAX_FILE_SIZE: # Double check after reading
             raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"ELF file exceeds size limit ({MAX_FILE_SIZE} bytes) after reading."
            )
        if not file_data:
             raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty ELF file received.")

        with tempfile.NamedTemporaryFile(delete=False, prefix="elf_upload_", suffix=".elf", mode='wb') as temp_f:
            temp_file_path = temp_f.name
            temp_f.write(file_data)
            logger.info(f"ELF data written to temporary file: {temp_file_path}")


        # --- Execute addr2line ---
        process = run_addr2line(temp_file_path, unique_addresses)

        # --- Create Address Resolution Map ---
        addr2line_results_map: Dict[str, str] = {}
        if process.returncode == 0 and process.stdout:
            lines = process.stdout.strip().split('\n')
            if len(lines) % 2 != 0:
                logger.warning(f"addr2line produced odd number of output lines. Output:\n{process.stdout}")

            for i in range(0, len(lines) - (len(lines) % 2), 2): # Safely iterate pairs
                func_name = lines[i]
                file_line = lines[i+1]
                original_addr = unique_addresses[i // 2] # Relies on addr2line preserving input order

                # Format the replacement string
                if func_name != "??" and file_line != "??:0":
                    resolved_string = f"{func_name} ({file_line})" # e.g., main (main.c:55)
                    resolved_count += 1
                elif file_line != "??:0":
                     resolved_string = file_line # e.g., main.c:55
                     resolved_count += 1
                else:
                    resolved_string = original_addr # Keep original if unresolved

                addr2line_results_map[original_addr] = resolved_string

        elif process.returncode != 0:
             # Log detailed error from stderr for server diagnostics
            logger.error(f"addr2line failed (code {process.returncode}) for {temp_file_path}: {process.stderr.strip()}")
            # Decide how to proceed: raise error or return original text? Let's raise.
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"addr2line execution failed. Cannot resolve addresses.",
            )
        # If process ran but stdout is empty (shouldn't happen if addresses were passed?), map will be empty

        # --- Perform Replacement using re.sub with a lambda ---
        def replace_match(match):
            addr = match.group(0)
            # Return resolved string if found, otherwise return original address
            return addr2line_results_map.get(addr, addr)

        # Apply the substitution using the *same* regex used for finding addresses
        modified_log_text = ADDRESS_REGEX.sub(replace_match, log_text)

        logger.info(f"Finished processing. Found: {num_unique_addresses}, Resolved: {resolved_count}")
        return ResolveLogResponse(
            resolved_log=modified_log_text,
            addresses_found=num_unique_addresses,
            addresses_resolved=resolved_count
            )

    # --- Exception Handling and Cleanup ---
    except HTTPException as http_exc:
         # Log and re-raise known HTTP exceptions
         logger.warning(f"HTTP Exception during processing: {http_exc.detail}")
         raise http_exc
    except Exception as e:
        # Log unexpected errors
        logger.error(f"An unexpected error occurred during log resolution: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal server error occurred during processing.",
        )
    finally:
        # --- CRUCIAL: Ensure Temporary File Deletion ---
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
                logger.info(f"Deleted temporary file: {temp_file_path}")
            except OSError as e:
                logger.error(f"Failed to delete temporary file {temp_file_path}: {e}")
        if elf_file:
            try:
                await elf_file.close() # Ensure UploadFile resources are released
            except Exception as e:
                logger.warning(f"Error closing upload file stream: {e}")

# --- Health Check Endpoint ---
@app.get("/health", status_code=status.HTTP_200_OK, summary="Health Check")
async def health_check():
    """Simple health check endpoint."""
    return {"status": "ok"}