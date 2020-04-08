import * as path from "path";
import {
	Event, EventEmitter, ExtensionContext, Task,
	TextDocument, ThemeIcon, TreeDataProvider, TreeItem, TreeItemCollapsibleState, Uri,
	WorkspaceFolder, commands, window, workspace, tasks, Selection, TaskGroup
} from "vscode";
import { visit, JSONVisitor } from "jsonc-parser";
import {
	BoxTaskDefinition, isWorkspaceFolder, getTaskName, createTask, isAutoDetectionEnabled
} from "./tasks";

class Folder extends TreeItem {
	packages: BoxJSON[] = [];
	workspaceFolder: WorkspaceFolder;

	constructor(folder: WorkspaceFolder) {
		super(folder.name, TreeItemCollapsibleState.Expanded);
		this.contextValue = "folder";
		this.resourceUri = folder.uri;
		this.workspaceFolder = folder;
		this.iconPath = ThemeIcon.Folder;
	}

	addPackage(boxJson: BoxJSON) {
		this.packages.push(boxJson);
	}
}

const packageName = "box.json";

class BoxJSON extends TreeItem {
	path: string;
	folder: Folder;
	scripts: BoxScript[] = [];

	static getLabel(_folderName: string, relativePath: string): string {
		if (relativePath.length > 0) {
			return path.join(relativePath, packageName);
		}
		return packageName;
	}

	constructor(folder: Folder, relativePath: string) {
		super(BoxJSON.getLabel(folder.label!, relativePath), TreeItemCollapsibleState.Expanded);
		this.folder = folder;
		this.path = relativePath;
		this.contextValue = "boxJSON";
		if (relativePath) {
			this.resourceUri = Uri.file(path.join(folder!.resourceUri!.fsPath, relativePath, packageName));
		} else {
			this.resourceUri = Uri.file(path.join(folder!.resourceUri!.fsPath, packageName));
		}
		this.iconPath = ThemeIcon.File;
	}

	addScript(script: BoxScript) {
		this.scripts.push(script);
	}
}

type ExplorerCommands = "open" | "run";

class BoxScript extends TreeItem {
	task: Task;
	package: BoxJSON;

	constructor(context: ExtensionContext, boxJson: BoxJSON, task: Task) {
		super(task.name, TreeItemCollapsibleState.None);
		const command: ExplorerCommands = workspace.getConfiguration("commandbox").get<ExplorerCommands>("scriptExplorerAction", "open");

		const commandList = {
			"open": {
				title: "Edit Script",
				command: "commandbox.openScript",
				arguments: [this]
			},
			"run": {
				title: "Run Script",
				command: "commandbox.runScript",
				arguments: [this]
			}
		};
		this.contextValue = "script";

		this.package = boxJson;
		this.task = task;
		this.command = commandList[command];

		if (task.group && task.group === TaskGroup.Clean) {
			this.iconPath = new ThemeIcon("wrench-subaction");
		} else {
			this.iconPath = new ThemeIcon("wrench");
		}
	}

	getFolder(): WorkspaceFolder {
		return this.package.folder.workspaceFolder;
	}
}

class NoScripts extends TreeItem {
	constructor(message: string) {
		super(message, TreeItemCollapsibleState.None);
		this.contextValue = "noscripts";
	}
}

export class BoxScriptsTreeDataProvider implements TreeDataProvider<TreeItem> {
	private taskTree: Folder[] | BoxJSON[] | NoScripts[] | null = null;
	private extensionContext: ExtensionContext;
	private _onDidChangeTreeData: EventEmitter<TreeItem | null> = new EventEmitter<TreeItem | null>();
	readonly onDidChangeTreeData: Event<TreeItem | null> = this._onDidChangeTreeData.event;

	constructor(context: ExtensionContext) {
		const subscriptions = context.subscriptions;
		this.extensionContext = context;
		subscriptions.push(commands.registerCommand("commandbox.runScript", this.runScript, this));
		subscriptions.push(commands.registerCommand("commandbox.openScript", this.openScript, this));
		subscriptions.push(commands.registerCommand("commandbox.refresh", this.refresh, this));
		subscriptions.push(commands.registerCommand("commandbox.runInstall", this.runInstall, this));
	}

	private async runScript(script: BoxScript): Promise<void> {
		tasks.executeTask(script.task);
	}

	private findScript(document: TextDocument, script?: BoxScript): number {
		let scriptOffset = 0;
		let inScripts = false;

		const visitor: JSONVisitor = {
			onError() {
				return scriptOffset;
			},
			onObjectEnd() {
				if (inScripts) {
					inScripts = false;
				}
			},
			onObjectProperty(property: string, offset: number, _length: number) {
				if (property === "scripts") {
					inScripts = true;
					if (!script) { // select the script section
						scriptOffset = offset;
					}
				} else if (inScripts && script) {
					const label = getTaskName(property, script.task.definition.path);
					if (script.task.name === label) {
						scriptOffset = offset;
					}
				}
			}
		};
		visit(document.getText(), visitor);
		return scriptOffset;
	}

	private async runInstall(selection: BoxJSON): Promise<void> {
		let uri: Uri | undefined = undefined;
		if (selection instanceof BoxJSON) {
			uri = selection.resourceUri;
		}
		if (!uri) {
			return;
		}
		const task = createTask("install", "install", selection.folder.workspaceFolder, uri, []);
		tasks.executeTask(task);
	}

	private async openScript(selection: BoxJSON | BoxScript): Promise<void> {
		let uri: Uri | undefined = undefined;
		if (selection instanceof BoxJSON) {
			uri = selection.resourceUri!;
		} else if (selection instanceof BoxScript) {
			uri = selection.package.resourceUri;
		}
		if (!uri) {
			return;
		}
		const document: TextDocument = await workspace.openTextDocument(uri);
		const offset = this.findScript(document, selection instanceof BoxScript ? selection : undefined);
		const position = document.positionAt(offset);
		await window.showTextDocument(document, { preserveFocus: true, selection: new Selection(position, position) });
	}

	public refresh() {
		this.taskTree = null;
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: TreeItem): TreeItem {
		return element;
	}

	getParent(element: TreeItem): TreeItem | null {
		if (element instanceof Folder) {
			return null;
		}
		if (element instanceof BoxJSON) {
			return element.folder;
		}
		if (element instanceof BoxScript) {
			return element.package;
		}
		if (element instanceof NoScripts) {
			return null;
		}
		return null;
	}

	async getChildren(element?: TreeItem): Promise<TreeItem[]> {
		if (!this.taskTree) {
			const taskItems = await tasks.fetchTasks({ type: "commandbox" });
			if (taskItems) {
				this.taskTree = this.buildTaskTree(taskItems);
				if (this.taskTree.length === 0) {
					let message = "No scripts found.";
					if (!isAutoDetectionEnabled()) {
						message = 'The setting "npm.autoDetect" is "off".';
					}
					this.taskTree = [new NoScripts(message)];
				}
			}
		}
		if (element instanceof Folder) {
			return element.packages;
		}
		if (element instanceof BoxJSON) {
			return element.scripts;
		}
		if (element instanceof BoxScript) {
			return [];
		}
		if (element instanceof NoScripts) {
			return [];
		}
		if (!element) {
			if (this.taskTree) {
				return this.taskTree;
			}
		}
		return [];
	}

	private isInstallTask(task: Task): boolean {
		const fullName = getTaskName("install", task.definition.path);
		return fullName === task.name;
	}

	private buildTaskTree(tasks: Task[]): Folder[] | BoxJSON[] | NoScripts[] {
		const folders: Map<String, Folder> = new Map();
		const packages: Map<String, BoxJSON> = new Map();

		let folder = null;
		let boxJson = null;

		tasks.forEach(each => {
			if (isWorkspaceFolder(each.scope) && !this.isInstallTask(each)) {
				folder = folders.get(each.scope.name);
				if (!folder) {
					folder = new Folder(each.scope);
					folders.set(each.scope.name, folder);
				}
				const definition: BoxTaskDefinition = <BoxTaskDefinition>each.definition;
				const relativePath = definition.path ? definition.path : "";
				const fullPath = path.join(each.scope.name, relativePath);
				boxJson = packages.get(fullPath);
				if (!boxJson) {
					boxJson = new BoxJSON(folder, relativePath);
					folder.addPackage(boxJson);
					packages.set(fullPath, boxJson);
				}
				const script = new BoxScript(this.extensionContext, boxJson, each);
				boxJson.addScript(script);
			}
		});
		if (folders.size === 1) {
			return [...packages.values()];
		}
		return [...folders.values()];
	}
}
