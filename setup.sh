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

# Check Hugo version
"$HOME/go/bin/hugo" version
