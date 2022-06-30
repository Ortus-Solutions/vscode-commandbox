import * as path from "path";
import {
	Event, EventEmitter, ExtensionContext, Task,
	TextDocument, ThemeIcon, TreeDataProvider, TreeItem, TreeItemLabel, TreeItemCollapsibleState, Uri,
	WorkspaceFolder, commands, window, workspace, tasks, Selection, TaskGroup, TextDocumentShowOptions, Range, Position, Location
} from "vscode";
import { readScripts } from "./readScripts";
import {
	BoxTaskDefinition, isWorkspaceFolder, getTaskName, createTask, getPackageManager, BoxTaskProvider, TaskWithLocation
} from "./tasks";

class Folder extends TreeItem {
	packages: BoxJSON[] = [];
	workspaceFolder: WorkspaceFolder;

	constructor( folder: WorkspaceFolder ) {
		super( folder.name, TreeItemCollapsibleState.Expanded );
		this.contextValue = "folder";
		this.resourceUri = folder.uri;
		this.workspaceFolder = folder;
		this.iconPath = ThemeIcon.Folder;
	}

	addPackage( boxJson: BoxJSON ): void {
		this.packages.push( boxJson );
	}
}

const packageName = "box.json";

class BoxJSON extends TreeItem {
	path: string;
	folder: Folder;
	scripts: BoxScript[] = [];

	static getLabel( relativePath: string ): string {
		if ( relativePath.length > 0 ) {
			return path.join( relativePath, packageName );
		}
		return packageName;
	}

	constructor( folder: Folder, relativePath: string ) {
		super( BoxJSON.getLabel( relativePath ), TreeItemCollapsibleState.Expanded );
		this.folder = folder;
		this.path = relativePath;
		this.contextValue = "boxJSON";
		if ( relativePath ) {
			this.resourceUri = Uri.file( path.join( folder!.resourceUri!.fsPath, relativePath, packageName ) );
		} else {
			this.resourceUri = Uri.file( path.join( folder!.resourceUri!.fsPath, packageName ) );
		}
		this.iconPath = ThemeIcon.File;
	}

	addScript( script: BoxScript ): void {
		this.scripts.push( script );
	}
}

type ExplorerCommands = "open" | "run";

class BoxScript extends TreeItem {
	task: Task;
	package: BoxJSON;
	taskLocation?: Location;

	constructor( _context: ExtensionContext, boxJson: BoxJSON, task: TaskWithLocation ) {
		const name = boxJson.path.length > 0
			? task.task.name.substring( 0, task.task.name.length - boxJson.path.length - 2 )
			: task.task.name;
		super( name, TreeItemCollapsibleState.None );
		this.taskLocation = task.location;
		const command: ExplorerCommands = workspace.getConfiguration( "commandbox" ).get<ExplorerCommands>( "scriptExplorerAction", "open" );

		const commandList = {
			"open" : {
				title     : "Edit Script",
				command   : "vscode.open",
				arguments : [
					this.taskLocation?.uri,
					this.taskLocation ? {
						selection : new Range( this.taskLocation.range.start, this.taskLocation.range.start )
					} as TextDocumentShowOptions : undefined
				]
			},
			"run" : {
				title     : "Run Script",
				command   : "commandbox.runScript",
				arguments : [ this ]
			}
		};
		this.contextValue = "script";

		this.package = boxJson;
		this.task = task.task;
		this.command = commandList[command];

		if ( this.task.group === TaskGroup.Clean ) {
			this.iconPath = new ThemeIcon( "wrench-subaction" );
		} else {
			this.iconPath = new ThemeIcon( "wrench" );
		}
		if ( this.task.detail ) {
			this.tooltip = this.task.detail;
			this.description = this.task.detail;
		}
	}

	getFolder(): WorkspaceFolder {
		return this.package.folder.workspaceFolder;
	}
}

class NoScripts extends TreeItem {
	constructor( message: string ) {
		super( message, TreeItemCollapsibleState.None );
		this.contextValue = "noscripts";
	}
}

type TaskTree = Folder[] | BoxJSON[] | NoScripts[];

export class BoxScriptsTreeDataProvider implements TreeDataProvider<TreeItem> {
	private taskTree: TaskTree | null = null;
	private extensionContext: ExtensionContext;
	private _onDidChangeTreeData: EventEmitter<TreeItem | null> = new EventEmitter<TreeItem | null>();
	readonly onDidChangeTreeData: Event<TreeItem | null> = this._onDidChangeTreeData.event;

	constructor( private context: ExtensionContext, public taskProvider: BoxTaskProvider ) {
		const subscriptions = context.subscriptions;
		this.extensionContext = context;
		subscriptions.push( commands.registerCommand( "commandbox.runScript", this.runScript, this ) );
		subscriptions.push( commands.registerCommand( "commandbox.openScript", this.openScript, this ) );
		subscriptions.push( commands.registerCommand( "commandbox.runInstall", this.runInstall, this ) );
	}

	private async runScript( script: BoxScript ): Promise<void> {
		// Call getPackageManager to trigger the multiple lock files warning.
		getPackageManager( this.context, script.getFolder().uri );
		tasks.executeTask( script.task );
	}

	private findScriptPosition( document: TextDocument, script?: BoxScript ): Position {
		const scripts = readScripts( document );
		if ( !scripts ) {
			return undefined;
		}

		if ( !script ) {
			return scripts.location.range.start;
		}

		const found = scripts.scripts.find( s => getTaskName( s.name, script.task.definition.path ) === script.task.name );

		return found?.nameRange.start;
	}

	private async runInstall( selection: BoxJSON ): Promise<void> {
		let uri: Uri | undefined = undefined;
		if ( selection instanceof BoxJSON ) {
			uri = selection.resourceUri;
		}
		if ( !uri ) {
			return;
		}
		const task = await createTask( getPackageManager( this.context, selection.folder.workspaceFolder.uri ), "install", [ "install" ], selection.folder.workspaceFolder, uri, undefined, [] );
		tasks.executeTask( task );
	}

	private async openScript( selection: BoxJSON | BoxScript ): Promise<void> {
		let uri: Uri | undefined = undefined;
		if ( selection instanceof BoxJSON ) {
			uri = selection.resourceUri!;
		} else if ( selection instanceof BoxScript ) {
			uri = selection.package.resourceUri;
		}
		if ( !uri ) {
			return;
		}
		const document: TextDocument = await workspace.openTextDocument( uri );
		const position = this.findScriptPosition( document, selection instanceof BoxScript ? selection : undefined ) || new Position( 0, 0 );
		await window.showTextDocument( document, { preserveFocus: true, selection: new Selection( position, position ) } );
	}

	public refresh(): void {
		this.taskTree = null;
		this._onDidChangeTreeData.fire( null );
	}

	getTreeItem( element: TreeItem ): TreeItem {
		return element;
	}

	getParent( element: TreeItem ): TreeItem | null {
		if ( element instanceof Folder ) {
			return null;
		}
		if ( element instanceof BoxJSON ) {
			return element.folder;
		}
		if ( element instanceof BoxScript ) {
			return element.package;
		}
		if ( element instanceof NoScripts ) {
			return null;
		}
		return null;
	}

	async getChildren( element?: TreeItem ): Promise<TreeItem[]> {
		if ( !this.taskTree ) {
			const taskItems = await this.taskProvider.tasksWithLocation;
			if ( taskItems ) {
				const taskTree = this.buildTaskTree( taskItems );
				this.taskTree = this.sortTaskTree( taskTree );
			}
		}
		if ( element instanceof Folder ) {
			return element.packages;
		}
		if ( element instanceof BoxJSON ) {
			return element.scripts;
		}
		if ( element instanceof BoxScript ) {
			return [];
		}
		if ( element instanceof NoScripts ) {
			return [];
		}
		if ( !element ) {
			if ( this.taskTree ) {
				return this.taskTree;
			}
		}
		return [];
	}

	private isInstallTask( task: Task ): boolean {
		const fullName = getTaskName( "install", task.definition.path );
		return fullName === task.name;
	}

	private getTaskTreeItemLabel( taskTreeLabel: string | TreeItemLabel | undefined ): string {
		if ( taskTreeLabel === undefined ) {
			return "";
		}

		if ( typeof taskTreeLabel === "string" ) {
			return taskTreeLabel;
		}

		return taskTreeLabel.label;
	}

	private sortTaskTree( taskTree: TaskTree ): TaskTree {
		return taskTree.sort( ( first: TreeItem, second: TreeItem ) => {
			const firstLabel = this.getTaskTreeItemLabel( first.label );
			const secondLabel = this.getTaskTreeItemLabel( second.label );
			return firstLabel.localeCompare( secondLabel );
		} );
	}

	private buildTaskTree( tasks: TaskWithLocation[] ): TaskTree {
		const folders: Map<string, Folder> = new Map();
		const packages: Map<string, BoxJSON> = new Map();

		let folder = null;
		let boxJson = null;

		const excludeConfig: Map<string, RegExp[]> = new Map();

		tasks.forEach( each => {
			const location = each.location;
			if ( location && !excludeConfig.has( location.uri.toString() ) ) {
				const regularExpressionsSetting = workspace.getConfiguration( "commandbox", location.uri ).get<string[]>( "scriptExplorerExclude", [] );
				excludeConfig.set( location.uri.toString(), regularExpressionsSetting?.map( value => RegExp( value ) ) );
			}
			const regularExpressions = ( location && excludeConfig.has( location.uri.toString() ) ) ? excludeConfig.get( location.uri.toString() ) : undefined;

			if ( regularExpressions?.some( ( regularExpression ) => ( each.task.definition as BoxTaskDefinition ).script.match( regularExpression ) ) ) {
				return;
			}

			if ( isWorkspaceFolder( each.task.scope ) && !this.isInstallTask( each.task ) ) {
				folder = folders.get( each.task.scope.name );
				if ( !folder ) {
					folder = new Folder( each.task.scope );
					folders.set( each.task.scope.name, folder );
				}
				const definition = each.task.definition as BoxTaskDefinition;
				const relativePath = definition.path ?? "";
				const fullPath = path.join( each.task.scope.name, relativePath );
				boxJson = packages.get( fullPath );
				if ( !boxJson ) {
					boxJson = new BoxJSON( folder, relativePath );
					folder.addPackage( boxJson );
					packages.set( fullPath, boxJson );
				}
				const script = new BoxScript( this.extensionContext, boxJson, each );
				boxJson.addScript( script );
			}
		} );
		if ( folders.size === 1 ) {
			return [ ...packages.values() ];
		}
		return [ ...folders.values() ];
	}
}
