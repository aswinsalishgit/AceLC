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
- **Automated Solution Uploader & Folder Structuring** - Creates standardized problem folders (`0001-Two-Sum/`) with `SOLUTION.java` and `PROBLEM.md` preserving original problem descriptions, examples, and constraints.
- **Complexity-Based Commit Messages** - Commits uploads using actual LeetCode runtime, memory usage, and Beats percentiles (`Time: 18 ms (99.42%), Space: 47 MB (39.37%) - AceLC`).
- **Difficulty Detection & Statistics Dashboard** - Automatically detects problem difficulty (`Easy`, `Medium`, `Hard`), tracks cumulative progress, and displays a responsive visual dashboard with dynamic greetings in the popup.
- **Repository README Dashboard & Problem Index** - Creates or incrementally updates an organized, minimalistic `README.md` dashboard at the top of the repository with center-aligned section headings and a structured problem index.
- **Reset Statistics** - Conveniently reset local problem-solving counts and synchronize the repository README dashboard with a single confirmation.
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
4. The extension uploads the solution to GitHub:
   - Standardized folder format: `<FOUR-DIGIT-PROBLEM-NUMBER>-<Problem-Title>` (e.g., `0001-Two-Sum/`).
   - Files created: `SOLUTION.java` (source code) and `PROBLEM.md` (complete problem statement, examples, constraints, and problem link).
   - Complexity commit message: `Time: 18 ms (99.42%), Space: 47 MB (39.37%) - AceLC` using actual runtime, memory, and Beats percentiles.
   - If a solution already exists in a destination folder, AceLC prompts you to **Overwrite** or **Skip**.
   - The repository `README.md` dashboard is automatically created or updated at the top of the file with center-aligned headings, cumulative statistics, and a structured problem index.
   - Cumulative difficulty counts (`Easy`, `Medium`, `Hard`) and dynamic progress greetings are updated in the popup dashboard.
   - Direct links to the uploaded files on GitHub are displayed upon completion.
5. You can also view and manage pending submissions directly from the extension popup, or reset statistics at any time using **Reset Statistics**.

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
