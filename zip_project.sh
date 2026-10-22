#!/bin/bash
# If RUN.game support asks for your project, run this to share your source.
# It’s meant for upload issues after you’ve tried everything else.

# Set archive filename based on the current directory name.
ARCHIVE_NAME="$(basename "$PWD").zip"

# Delete any pre-existing archive to avoid appending to an old file.
rm -f "$ARCHIVE_NAME"

# Zip everything in this directory except unwanted folders/files.
zip -r "$ARCHIVE_NAME" . -x "node_modules/*" -x ".git/*" -x "*.DS_Store"

# Provide confirmation that the archive was created successfully.
echo "Created $ARCHIVE_NAME"
