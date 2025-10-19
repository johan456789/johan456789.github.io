#!/bin/bash

# Update package lists
sudo apt-get update

# Install Hugo
sudo apt-get install -y hugo

# Initialize and update git submodules
git submodule init
git submodule update

# Run Hugo server in the background
hugo server -D --bind=0.0.0.0 --port=1313 > hugo.log 2>&1 &
