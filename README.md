I am building AceLC, an open-source Chrome extension that automatically uploads users’ LeetCode solutions to their GitHub repositories.

I want to begin with a simple MVP that focuses exclusively on solution uploading. Do not introduce advanced features or unnecessary complexity.

### 1. Core functionality

The extension should support this workflow:

1. The user installs and opens AceLC in Chrome.
2. The user authenticates their GitHub account.
3. The user either:
   - Creates a new GitHub repository and chooses whether it is public or private.
   - Selects an existing repository.
4. The user can create and manage destination folders within the selected repository.
5. The user clicks "Get Started" to activate AceLC.
6. When the user successfully submits a solution on LeetCode, AceLC detects the submission and prompts the user to select the folder(s) where the solution should be uploaded.
7. After confirmation, AceLC uploads the solution to the selected GitHub repository and folder(s).

### 2. Technology stack

Use only:
- HTML
- CSS
- Vanilla JavaScript
- Chrome Extension APIs
- GitHub APIs

Build the extension using Chrome's Manifest V3 architecture.

Avoid frameworks, libraries, build tools, or unnecessary dependencies unless they are genuinely required.

### 3. Development principles

This is an open-source educational project. Code readability and simplicity are extremely important.

Follow these principles throughout development:

- Write beginner-friendly, easy-to-understand code.
- Prefer simple solutions over clever or unnecessarily complex implementations.
- Use meaningful variable, function, and file names.
- Add clear comments explaining the purpose and functionality of every important line, function, and code block.
- Organise the project into a logical, easy-to-navigate folder structure.
- Avoid unnecessary abstractions and premature optimisation.
- Follow basic security practices, especially when handling GitHub authentication and access tokens.
- Never expose client secrets, credentials, or sensitive tokens in publicly accessible source code.

### 4. How I want you to guide development

I am using Antigravity IDE and want to build this project incrementally.

First, provide:

**A. Development roadmap**
- Break the MVP into logical development phases.
- Explain what each phase accomplishes.
- Identify dependencies between phases.

**B. Master prompt**
- Write one comprehensive master prompt that establishes the project context, architecture, requirements, coding standards, and overall development goals.

**C. Implementation sub-prompts**
- Write separate, sequential prompts for each development phase.
- Each prompt should focus on a specific, manageable implementation task.
- Include clear instructions, expected outcomes, and acceptance criteria.
- Ensure each prompt builds upon the code created in previous phases.

### 5. Important instructions

- Do not attempt to build the entire extension in one step.
- Do not skip architectural or foundational steps.
- Do not introduce features outside the defined MVP scope.
- Explain important technical decisions in beginner-friendly language.
- Ensure every phase results in working, testable code.
- Maintain consistency across files and implementation phases.

The ultimate goal is to create a simple, reliable, secure, and maintainable open-source Chrome extension that even beginner developers can understand, contribute to, and learn from.
