# Use official Ubuntu 20.04 as base image
FROM ubuntu:20.04

# Set environment variables to non-interactive (prevents some prompts)
ENV DEBIAN_FRONTEND=noninteractive

# Install necessary packages and dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip jq chromium chromium-driver wget unzip ca-certificates fonts-liberation \
    libappindicator3-1 libasound2 libatk-bridge2.0-0 libatk1.0-0 libc6 libcairo2 libcups2 \
    libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libglib2.0-0 libgtk-3-0 libnspr4 \
    libnss3 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 \
    libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 lsb-release \
    xdg-utils && rm -rf /var/lib/apt/lists/*

# Install Python packages
RUN pip3 install --no-cache-dir selenium==4.9.1 python-dotenv requests

# Create a non-root user
RUN useradd -ms /bin/bash appuser
USER appuser

# Set work directory
WORKDIR /app

# Copy application files
COPY scrapper.py /app/scrapper.py

# Default command
CMD ["python3", "scrapper.py"]
