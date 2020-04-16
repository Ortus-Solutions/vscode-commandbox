# Contributing

If you would like to contribute enhancements or fixes, please read this document first.

## Before starting

- Please discuss the changes you intend to make in an [issue](https://github.com/Ortus-Solutions/vscode-commandbox/issues) prior to beginning work.
- You should be familiar with [TypeScript](https://www.typescriptlang.org) and [VS Code extension development](https://code.visualstudio.com/api).

## Developing

### Prerequisites

- [Git](https://git-scm.com)
- [Node.js with npm](https://nodejs.org)
- [Visual Studio Code](https://code.visualstudio.com)

### Setup

1. Fork [Ortus-Solutions/vscode-commandbox](https://github.com/Ortus-Solutions/vscode-commandbox)
1. Clone your forked repository

### Starting work

It is recommended to work on a separate feature branch created from the latest `master`

- Open this repository as the workspace in VS Code
- Run `npm install` at workspace root to install dependencies

### Debugging

Run the `Launch Extension` debug target in the [Debug View](https://code.visualstudio.com/docs/editor/debugging). This will:

- Launch the `preLaunchTask` task to compile the extension
- Launch a new VS Code instance with the `vscode-commandbox` extension loaded
- Display a notification saying the development version of `vscode-commandbox` overwrites the bundled version of `vscode-commandbox` if you have an older version installed

### Guidelines

- Use `scripts` in [`package.json`](./package.json) to perform common development tasks.
- Project must pass **ESLint** and **Markdown lint** with no errors using the included configuration.
- Please use descriptive variable names and only use well-known abbreviations.

### Submitting a Pull Request

- Make a pull request to the upstream `master` when ready.
