# AceLC

**AceLC** is an open-source Chrome extension that automatically uploads your accepted [LeetCode](https://leetcode.com/) solutions to your [GitHub](https://github.com/) repository.

Built by [CodeGab](https://github.com/CodeGab) to make tracking and managing coding practice simple and effortless.

## Features

- **Manifest V3 Foundation** - Service worker lifecycle and storage persistence setup.
- **GitHub Authentication** - Connect and disconnect GitHub accounts securely using OAuth Device Flow.
- **Repository Management** - Retrieve, select existing, or create new public and private GitHub repositories.
- **Destination Folder Management** - Configure multiple destination folders per repository, with support for custom paths and existing GitHub directories.
- **LeetCode Submission Detection** - Detect accepted submissions, snapshot source code at submit time, identify languages, and extract problem metadata.
- **Submission Destination Selection** - In-page modal and popup interface to select one or multiple destination folders, validate targets, and manage pending submissions.
- **GitHub Solution Uploading** - Upload accepted solutions to selected repository folders via GitHub Contents API, with Base64 Unicode encoding, conflict detection, and overwrite protection.
- **Extension Popup** - Multi-state interface for authorization codes, approval checks, repository selection, folder configuration, and user profile display.
- **Options Management** - Dedicated settings page for OAuth application configuration and destination repository settings.
- **Shared Architecture** - Unified constants and messaging protocol across components.

## Tech Stack

- HTML
- CSS
- JavaScript
- Chrome Extension Manifest V3
- GitHub REST API

## Getting Started

To load the extension locally in Google Chrome:

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select the repository directory.
5. Click the AceLC icon in the Chrome toolbar to open the extension popup.

## Project Status

AceLC is currently under development. Phase 7 (GitHub Solution Uploading) is complete.

## Contributing

Contributions, suggestions, and bug reports are welcome!

Please check the project's contribution guidelines before submitting a pull request.

## License

This project is licensed under the [MIT License](LICENSE).
