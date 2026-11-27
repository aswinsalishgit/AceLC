<h1 align="center">CodeGab AceLC (by Aswin Salish)</h1>

<p align="center"><img width="300" height="300" alt="Glossy Cat Coding Mascot-Photoroom" src="Popup/icon.png" /></p>

**AceLC** is an open-source Manifest V3 Chrome extension developed under **CodeGab** that automatically uploads accepted [LeetCode](https://leetcode.com/) solutions directly to your [GitHub](https://github.com/) repositories.

---

## What's New in v1.0.1

- **Seamless Browser-Based OAuth Authorization**: Connect your GitHub account with a fast, direct browser redirect flow — no more manual copy-pasting of device verification codes.
- **Modern Swiss Dark Theme UI**: A refined dark aesthetic (`#1a1a1a`, `#262626`, `#373737`) across popup, settings, and modal dialogs with smooth action animations and centered layouts.
- **Native LeetCode Push Button**: The submission modal action button mirrors LeetCode's native Submit button styling with the official green cloud-upload icon and crisp "Push" label.
- **Clean Performance Metrics**: Metric tags display clean percentages in parentheses without repetitive "Beats" labels (e.g. `2 ms (64.0%)` and `85.41 MB (25.5%)`).
- **Brand Logo in Modals**: High-resolution `icon.png` is integrated directly into modal headers in place of legacy text pills.
- **Direct GitHub Profile Navigation**: Clicking your profile avatar, username, or handle opens your GitHub profile in a single click.
- **Reliable Submission Triggers**: Filtered out testcase evaluation runs so the destination modal opens strictly for actual accepted submissions.
- **Safer Destination Selection**: Destination folder checkboxes start unchecked by default for deliberate and accurate target selection.

---

## Features

- **Manifest V3 Architecture**: Built for the latest Chrome extension standards with modern service worker lifecycle management.
- **Streamlined GitHub Authentication**: Secure browser-based OAuth authorization with automatic token exchange and graceful device flow fallback.
- **Repository Management**: Search, filter, and switch between your existing GitHub repositories, or create a brand new public/private repository directly from the extension.
- **Destination Folder Organization**: Configure multiple target folders per repository, select existing directories, or add custom folder paths (e.g., `LeetCode/Easy/`).
- **Real-Time Accepted Submission Detection**: Listens for accepted LeetCode solutions, snapshots source code at submission time, and extracts problem metadata and difficulty.
- **Interactive Destination Modal**: In-page modal dialog lets you select which destination folders to push your code into, with instant validation.
- **Standardized Problem Structuring**: Generates clean folders (`0001-Two-Sum/`) containing:
  - `SOLUTION.<ext>`: The exact accepted source code in the submitted programming language.
  - `PROBLEM.md`: Complete problem description, constraints, examples, topics, and original LeetCode link.
- **Complexity-Based Commit Messages**: Commits code with actual runtime and memory stats: `Time: 18 ms (99.42%), Space: 47 MB (39.37%) - AceLC`.
- **Repository README Dashboard & Problem Index**: Automatically updates your repository's root `README.md` with an organized statistics summary table and problem index.
- **Statistics Tracking & Synchronization**: Tracks your solved problem counts across difficulties (Easy, Medium, Hard), with an easy one-click reset to re-synchronize local and remote counts.
- **Conflict & Overwrite Protection**: Displays an overwrite prompt if a solution already exists in the selected destination folder, giving you full control to overwrite or skip.

---

## Tech Stack

- HTML5 & CSS3 (Modern Swiss Dark Theme)
- JavaScript (ES6+ / Chrome Extensions Manifest V3)
- GitHub REST API v3 & OAuth 2.0
- LeetCode Dynamic DOM & REST Interception

---

## Installation and Setup

### Prerequisites

- Google Chrome (or any Chromium browser: Brave, Edge, Opera, Vivaldi).
- A GitHub account.

### Loading the Extension in Chrome

1. Clone or download this repository:
   ```bash
   git clone https://github.com/aswinsalishgit/CodeGab-AceLC.git
   ```
2. Open Google Chrome and navigate to:
   ```text
   chrome://extensions
   ```
3. Turn on **Developer mode** using the toggle switch in the top-right corner.
4. Click the **Load unpacked** button in the top-left corner.
5. Select the `CodeGab - AceLC` directory (the folder containing `manifest.json`).
6. Pin **AceLC** to your browser toolbar for quick access.

### Initial Configuration

1. Click the **AceLC** icon in your browser toolbar.
2. Click **Connect GitHub**.
3. Authorize AceLC in the browser window to complete the connection automatically.
4. Select an existing destination repository (or create a new one using **+ New Repository**).
5. Add or configure your desired destination folders (e.g., `LeetCode`, `Easy`, `Medium`).

---

## Usage

1. Open any problem on [LeetCode](https://leetcode.com/problems/).
2. Write your solution in your preferred language and click **Submit**.
3. When your solution is **Accepted**:
   - The AceLC modal dialog appears showing problem details, difficulty, runtime, and memory metrics.
   - Check the destination folder(s) where you want to upload the solution.
   - Click **Push**.
4. AceLC uploads your code and problem markdown to GitHub, commits with runtime/memory metrics, and updates the repository README index.
5. Direct GitHub links to your uploaded files are presented upon completion.

---

## Contributing

Contributions, feedback, and feature requests are welcome! Feel free to open an issue or submit a pull request on GitHub.

---

## License

This project is licensed under the [MIT License](LICENSE).
