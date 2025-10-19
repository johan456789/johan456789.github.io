#!/bin/bash

# Update package lists and install Go
sudo apt-get update
sudo apt-get install -y golang-go

# Install specific Hugo version using go install
echo "Installing Hugo v0.123.8..."
CGO_ENABLED=1 go install -tags extended github.com/gohugoio/hugo@v0.123.8

# Initialize and update git submodules
echo "Initializing and updating git submodules..."
git submodule init
git submodule update

# Run Hugo server in the background using the correct path
echo "Starting Hugo server..."
"$HOME/go/bin/hugo" server -D --bind=0.0.0.0 --port=1313 > hugo.log 2>&1 &
