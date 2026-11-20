# AceLC

**AceLC** is an open-source Chrome extension that automatically uploads your accepted [LeetCode](https://leetcode.com/) solutions to your [GitHub](https://github.com/) repository.

Built by [CodeGab](https://github.com/CodeGab) to make tracking and managing coding practice simple and effortless.

## Features

- **Manifest V3 Foundation** - Service worker lifecycle and storage persistence setup.
- **GitHub Authentication** - Connect and disconnect GitHub accounts securely using OAuth Device Flow.
- **Extension Popup** - Multi-state interface for authorization codes, approval checks, and user profile display.
- **Options Management** - Dedicated settings page for OAuth application configuration and connection status.
- **LeetCode Detection Hook** - Content script targeting LeetCode problem pages.
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

AceLC is currently under development. Phase 2 (GitHub Authentication) is complete.

## Contributing

Contributions, suggestions, and bug reports are welcome!

Please check the project's contribution guidelines before submitting a pull request.

## License

This project is licensed under the [MIT License](LICENSE).
