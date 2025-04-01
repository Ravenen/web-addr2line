# Use an official Python runtime as a parent image
FROM python:3.11-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE 1 # Prevents python creating .pyc files
ENV PYTHONUNBUFFERED 1       # Prevents python buffering stdout/stderr

# Install binutils (provides addr2line) and clean up apt cache
RUN apt-get update \
    && apt-get install -y --no-install-recommends binutils \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory in the container
WORKDIR /app

# Copy the requirements file into the container
COPY requirements.txt .

# Install any needed packages specified in requirements.txt
# Use --no-cache-dir to keep image size smaller
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code into the container
COPY ./main.py .
# If you had other .py files or directories, copy them too:
# COPY ./src ./src

# Make port 8000 available to the world outside this container
EXPOSE 8000

# Define the command to run the application using Uvicorn
# Runs on 0.0.0.0 to be accessible from outside the container
# The number of workers can be adjusted based on CPU cores available
# Uvicorn's default single worker with multiple event loops handles concurrency well for I/O bound
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

# Optional: Add a healthcheck instruction for Docker
# HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
#   CMD curl -f http://localhost:8000/health || exit 1