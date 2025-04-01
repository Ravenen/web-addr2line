from fastapi import FastAPI, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
import subprocess
import tempfile
import os
import re

app = FastAPI()

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with actual origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/convert")
async def convert_addresses(text: str = Form(...), elf_file: UploadFile = Form(...)):
    # Save uploaded ELF file temporarily
    with tempfile.NamedTemporaryFile(delete=False) as temp_elf:
        content = await elf_file.read()
        temp_elf.write(content)
        temp_elf.flush()
        
        # Find all addresses in text
        addresses = re.findall(r'0x[0-9a-fA-F]+', text)
        result_text = text
        
        for addr in addresses:
            try:
                # Run addr2line command
                process = subprocess.run(
                    ['addr2line', '-e', temp_elf.name, '-f', '-C', addr],
                    capture_output=True,
                    text=True
                )
                
                if process.returncode == 0:
                    func_name = process.stdout.splitlines()[0]
                    file_line = process.stdout.splitlines()[1]
                    result_text = result_text.replace(
                        addr,
                        f"{addr} ({func_name} at {file_line})"
                    )
            except Exception as e:
                print(f"Error processing address {addr}: {e}")
        
        # Clean up
        os.unlink(temp_elf.name)
        
        return {"converted_text": result_text}
