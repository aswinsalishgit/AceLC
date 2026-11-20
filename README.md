# AceLC

**AceLC** is an open-source Chrome extension that automatically uploads your accepted [LeetCode](https://leetcode.com/) solutions to your [GitHub](https://github.com/) repository.

Built by [CodeGab](https://github.com/CodeGab) to make tracking and managing coding practice simple and effortless.

## Features

- **Manifest V3 Architecture** - Native Chrome extension with service worker lifecycle and persistent local storage.
- **GitHub Authentication** - Secure OAuth Device Authorization Flow with automatic polling and manual verification.
- **Repository Management** - Retrieve existing repositories with pagination, select active target, or create new public/private repositories directly from the popup.
- **Destination Folder Management** - Configure multiple destination folders per repository, select existing directories, or add custom folder paths.
- **Accepted Submission Detection** - Real-time detection of accepted LeetCode submissions with automatic source code capture, programming language normalization, and problem metadata extraction.
- **Destination Selection Interface** - In-page modal dialog and extension popup card allowing selection of one or multiple destination folders with validation.
- **GitHub Solution Uploading** - Uploads solution files via GitHub Contents REST API, complete with Base64 Unicode encoding, pre-upload file existence checking, conflict detection, and overwrite/skip protection.
- **Multi-Destination & Partial Failure Handling** - Independent tracking of upload outcomes across multiple target directories without repeating successful uploads.
- **Queue Management** - Handles multiple submissions in sequence without mixing source code or destinations.

## Tech Stack

- HTML5
- CSS3
- JavaScript (ES6+)
- Chrome Extension Manifest V3
- GitHub REST API v3

## Installation and Setup

### Prerequisites

- Google Chrome (or any Chromium-based browser supporting Manifest V3).
- A GitHub account.
- A GitHub OAuth App Client ID (or use the configured default).

### Loading the Extension Manually

1. Clone or download this repository:
   ```bash
   git clone https://github.com/aswinsalishgit/CodeGab-AceLC.git
   ```
2. Open Google Chrome and navigate to:
   ```text
   chrome://extensions
   ```
3. Enable **Developer mode** using the toggle switch in the top-right corner.
4. Click the **Load unpacked** button in the top-left corner.
5. Select the `CodeGab - AceLC` directory containing `manifest.json`.
6. The **AceLC** extension card will appear in your extensions list. Pin it to your Chrome toolbar for easy access.

### Initial Configuration

1. Click the AceLC icon in the toolbar to open the popup.
2. Enter your GitHub OAuth App Client ID (if not pre-configured), then click **Connect GitHub**.
3. Copy the 8-character user code and click **Open GitHub Page**.
4. Enter the code on GitHub and authorize the application for your account.
5. Return to the extension popup and click **I've Approved on GitHub** (or wait for automatic polling).
6. Under **Repository Configuration**, select an existing repository or create a new one.
7. Under **Destination Folders**, add at least one folder path (e.g., `LeetCode` or `Algorithms/LeetCode`).

## Usage

1. Open any problem on [LeetCode](https://leetcode.com/problems/) (e.g., `https://leetcode.com/problems/two-sum/`).
2. Solve the problem in the code editor and click **Submit**.
3. When your submission is judged as **Accepted**:
   - An in-page modal dialog appears showing problem title, language, and configured folders.
   - Select the destination folder(s) where the solution should be saved.
   - Click **Upload Solution**.
4. The extension uploads the solution file to GitHub:
   - Filename format: `<problem-number>-<problem-slug>.<ext>` (e.g., `1-two-sum.py`).
   - If the file already exists in a destination folder, AceLC prompts you to **Overwrite** or **Skip**.
   - Direct links to the uploaded files on GitHub are displayed upon completion.
5. You can also view and manage pending submissions directly from the extension popup.

## Known Limitations

- **Single Active Account**: AceLC connects to one GitHub account at a time. Switching accounts requires disconnecting first.
- **Tab Reload Required on Extension Update**: When the extension is reloaded in `chrome://extensions` during development, existing open LeetCode tabs must be refreshed (`F5`) to re-inject content scripts.
- **Monaco Editor DOM Dependencies**: LeetCode UI updates may affect DOM selectors; AceLC uses multi-model inspections and DOM fallbacks to maintain resilience.
- **Empty Repositories**: Freshly created empty repositories without a default branch or commits will initialize directory trees upon first solution upload.
- **GitHub API Rate Limits**: GitHub unauthenticated/standard authenticated requests are subject to rate limits (5,000 requests/hour for authenticated users).

## Contributing

Contributions, suggestions, and bug reports are welcome!

Please check the project's contribution guidelines before submitting a pull request.

## License

This project is licensed under the [MIT License](LICENSE).
