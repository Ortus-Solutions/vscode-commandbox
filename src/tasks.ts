import {
	TaskDefinition, Task, TaskGroup, WorkspaceFolder, RelativePattern, ShellExecution, Uri, workspace,
	TaskProvider, TextDocument, tasks, TaskScope, QuickPickItem, Position, ExtensionContext,
	ShellQuotedString, ShellQuoting, Location, CancellationTokenSource
} from "vscode";
import * as path from "path";
import * as micromatch from "micromatch";
import { IBoxScriptInfo, readScripts } from "./readScripts";

export interface BoxTaskDefinition extends TaskDefinition {
	script: string;
	path?: string;
}

export interface FolderTaskItem extends QuickPickItem {
	label: string;
	task: Task;
}

export type AutoDetect = "on" | "off";

let cachedTasks: TaskWithLocation[] | undefined = undefined;

const INSTALL_SCRIPT = "install";

export interface TaskLocation {
	document: Uri;
	line: Position;
}

export interface TaskWithLocation {
	task: Task;
	location?: Location;
}

export class BoxTaskProvider implements TaskProvider {

	constructor( private context: ExtensionContext ) {
	}

	get tasksWithLocation(): Promise<TaskWithLocation[]> {
		return provideBoxScripts( this.context );
	}

	public async provideTasks(): Promise<Task[]> {
		const tasks = await provideBoxScripts( this.context );
		return tasks.map( task => task.task );
	}

	public async resolveTask( _task: Task ): Promise<Task | undefined> {
		if ( "script" in _task.definition ) {
			const kind = _task.definition as BoxTaskDefinition;
			let boxJsonUri: Uri;
			if ( _task.scope === undefined || _task.scope === TaskScope.Global || _task.scope === TaskScope.Workspace ) {
				// scope is required to be a WorkspaceFolder for resolveTask
				return undefined;
			}
			if ( kind.path ) {
				boxJsonUri = _task.scope.uri.with( { path: `${_task.scope.uri.path}/${kind.path}${kind.path.endsWith( "/" ) ? "" : "/"}box.json` } );
			} else {
				boxJsonUri = _task.scope.uri.with( { path: `${_task.scope.uri.path}/box.json` } );
			}

			const cmd = [ kind.script ];
			if ( kind.script !== INSTALL_SCRIPT ) {
				cmd.unshift( "run-script" );
			}

			return createTask( getPackageManager( this.context, _task.scope.uri ), kind, cmd, _task.scope, boxJsonUri );
		}

		return undefined;
	}
}

export function invalidateTasksCache(): void {
	cachedTasks = undefined;
}

function isBuildTask( lowerName: string, boxJsonUri: Uri ): boolean {
	const buildNames = workspace.getConfiguration( "commandbox", boxJsonUri ).get<string[]>( "buildNames", [] );
	return buildNames.some( ( buildName ) => lowerName.includes( buildName ) );
}

function isTestTask( lowerName: string, boxJsonUri: Uri ): boolean {
	const testNames = workspace.getConfiguration( "commandbox", boxJsonUri ).get<string[]>( "testNames", [] );
	return testNames.some( ( testName ) => lowerName.startsWith( testName ) );
}

function isPrePostScript( name: string ): boolean {
	const prePostScripts: Set<string> = new Set( [
		"preinstall", "postinstall", "preuninstall", "postuninstall",
		"preversion", "postversion", "prepublish", "postpublish",
		"preunpublish", "postunpublish"
	] );

	const prepost = [ "pre" + name, "post" + name ];
	for ( const knownScript of prePostScripts ) {
		if ( knownScript === prepost[0] || knownScript === prepost[1] ) {
			return true;
		}
	}

	return false;
}

export function isWorkspaceFolder( value: unknown ): value is WorkspaceFolder {
	return value && typeof value !== "number";
}

export function getPackageManager( _extensionContext: ExtensionContext, _folder: Uri ): string {
	return "box";
}

export async function hasBoxScripts(): Promise<boolean> {
	const folders = workspace.workspaceFolders;
	if ( !folders ) {
		return false;
	}
	try {
		for ( const folder of folders ) {
			if ( isAutoDetectionEnabled( folder ) ) {
				const relativePattern = new RelativePattern( folder, "**/box.json" );
				const paths = await workspace.findFiles( relativePattern );
				if ( paths.length > 0 ) {
					return true;
				}
			}
		}
		return false;
	} catch ( error ) {
		return Promise.reject( error );
	}
}

async function detectBoxScripts( context: ExtensionContext ): Promise<TaskWithLocation[]> {
	const emptyTasks: TaskWithLocation[] = [];
	const allTasks: TaskWithLocation[] = [];
	const visitedBoxJsonFiles: Set<string> = new Set();

	const folders = workspace.workspaceFolders;
	if ( !folders ) {
		return emptyTasks;
	}
	try {
		for ( const folder of folders ) {
			if ( isAutoDetectionEnabled( folder ) ) {
				const relativePattern = new RelativePattern( folder, "**/box.json" );
				const paths = await workspace.findFiles( relativePattern );
				for ( const path of paths ) {
					if ( !isExcluded( folder, path ) && !visitedBoxJsonFiles.has( path.fsPath ) ) {
						const tasks = await provideBoxScriptsForFolder( context, path );
						visitedBoxJsonFiles.add( path.fsPath );
						allTasks.push( ...tasks );
					}
				}
			}
		}
		return allTasks;
	} catch ( error ) {
		return Promise.reject( error );
	}
}

export async function detectBoxScriptsForFolder( context: ExtensionContext, folder: Uri ): Promise<FolderTaskItem[]> {
	const folderTasks: FolderTaskItem[] = [];

	try {
		const relativePattern = new RelativePattern( folder.fsPath, "**/box.json" );
		const paths = await workspace.findFiles( relativePattern );

		const visitedBoxJsonFiles: Set<string> = new Set();
		for ( const path of paths ) {
			if ( !visitedBoxJsonFiles.has( path.fsPath ) ) {
				const tasks = await provideBoxScriptsForFolder( context, path );
				visitedBoxJsonFiles.add( path.fsPath );
				folderTasks.push( ...tasks.map( t => ( { label: t.task.name, task: t.task } ) ) );
			}
		}
		return folderTasks;
	} catch ( error ) {
		return Promise.reject( error );
	}
}

export async function provideBoxScripts( context: ExtensionContext ): Promise<TaskWithLocation[]> {
	if ( !cachedTasks ) {
		cachedTasks = await detectBoxScripts( context );
	}
	return cachedTasks;
}

export function isAutoDetectionEnabled( folder?: WorkspaceFolder ): boolean {
	return workspace.getConfiguration( "commandbox", folder?.uri ).get<AutoDetect>( "autoDetect" ) === "on";
}

function isExcluded( folder: WorkspaceFolder, boxJsonUri: Uri ): boolean {
	const exclude = workspace.getConfiguration( "commandbox", folder.uri ).get<string | string[]>( "exclude" );
	const boxJsonFolder = path.dirname( boxJsonUri.fsPath );

	if ( exclude ) {
		return micromatch.isMatch( boxJsonFolder, exclude );
	}
	return false;
}

async function provideBoxScriptsForFolder( context: ExtensionContext, boxJsonUri: Uri ): Promise<TaskWithLocation[]> {
	const emptyTasks: TaskWithLocation[] = [];

	const folder = workspace.getWorkspaceFolder( boxJsonUri );
	if ( !folder ) {
		return emptyTasks;
	}
	const scripts = await getScripts( boxJsonUri );
	if ( !scripts ) {
		return emptyTasks;
	}

	const result: TaskWithLocation[] = [];

	const packageManager = getPackageManager( context, folder.uri );

	for ( const { name, value, nameRange } of scripts.scripts ) {

		const task = await createTask( packageManager, name, [ "run-script", name ], folder!, boxJsonUri, value, undefined );

		result.push( { task, location: new Location( boxJsonUri, nameRange ) } );
	}

	if ( !workspace.getConfiguration( "commandbox", folder ).get<string[]>( "scriptExplorerExclude", [] ).find( e => e.includes( INSTALL_SCRIPT ) ) ) {
		result.push( { task: await createTask( packageManager, INSTALL_SCRIPT, [ INSTALL_SCRIPT ], folder, boxJsonUri, "install dependencies from package", [] ) } );
	}

	return result;
}

export function getTaskName( script: string, relativePath: string | undefined ): string {
	if ( relativePath?.length ) {
		return `${script} - ${relativePath.substring( 0, relativePath.length - 1 )}`;
	}
	return script;
}

export async function createTask( packageManager: string, script: BoxTaskDefinition | string, cmd: string[], folder: WorkspaceFolder, boxJsonUri: Uri, scriptValue?: string, matcher?: string | string[] ): Promise<Task> {
	let kind: BoxTaskDefinition;
	if ( typeof script === "string" ) {
		kind = { type: "commandbox", script: script };
	} else {
		kind = script;
	}

	function getCommandLine( cmd: string[] ): ( string | ShellQuotedString )[] {
		const result: ( string | ShellQuotedString )[] = new Array( cmd.length );
		for ( let i = 0; i < cmd.length; i++ ) {
			if ( /\s/.test( cmd[i] ) ) {
				result[i] = { value: cmd[i], quoting: cmd[i].includes( "--" ) ? ShellQuoting.Weak : ShellQuoting.Strong };
			} else {
				result[i] = cmd[i];
			}
		}

		return result;
	}

	function getRelativePath( boxJsonUri: Uri ): string {
		const rootUri = folder.uri;
		const absolutePath = boxJsonUri.path.substring( 0, boxJsonUri.path.length - "box.json".length );
		return absolutePath.substring( rootUri.path.length + 1 );
	}

	const relativeBoxJson = getRelativePath( boxJsonUri );
	if ( relativeBoxJson.length && !kind.path ) {
		kind.path = relativeBoxJson.slice( 0, -1 );
	}
	const taskName = getTaskName( kind.script, relativeBoxJson );
	const cwd = path.dirname( boxJsonUri.fsPath );
	const task = new Task( kind, folder, taskName, "commandbox", new ShellExecution( packageManager, getCommandLine( cmd ), { cwd: cwd } ), matcher );
	task.detail = scriptValue;

	const lowerCaseTaskName = kind.script.toLowerCase();
	if ( isBuildTask( lowerCaseTaskName, boxJsonUri ) ) {
		task.group = TaskGroup.Build;
	} else if ( isTestTask( lowerCaseTaskName, boxJsonUri ) ) {
		task.group = TaskGroup.Test;
	} else if ( isPrePostScript( lowerCaseTaskName ) ) {
		task.group = TaskGroup.Clean; // hack: use Clean group to tag pre/post scripts
	}

	return task;
}


export function getBoxJsonUriFromTask( task: Task ): Uri | null {
	if ( isWorkspaceFolder( task.scope ) ) {
		if ( task.definition.path ) {
			return Uri.joinPath( task.scope.uri, task.definition.path, "box.json" );
		} else {
			return Uri.joinPath( task.scope.uri, "box.json" );
		}
	}
	return null;
}

async function exists( fileUri: Uri ): Promise<boolean> {
	try {
		await workspace.fs.stat( fileUri );
		return true;
	} catch ( err ) {
		return false;
	}
}

export async function hasBoxJson(): Promise<boolean> {
	const token = new CancellationTokenSource();
	// Search for files for max 1 second.
	const timeout = setTimeout( () => token.cancel(), 1000 );
	const files = await workspace.findFiles( "**/box.json", undefined, 1, token.token );
	clearTimeout( timeout );
	return files.length > 0 || await hasRootBoxJson();
}

async function hasRootBoxJson(): Promise<boolean> {
	const folders = workspace.workspaceFolders;
	if ( !folders ) {
		return false;
	}
	for ( const folder of folders ) {
		const boxJson = Uri.joinPath( folder.uri, "box.json" );
		if ( await exists( boxJson ) ) {
			return true;
		}
	}
	return false;
}

export async function runScript( context: ExtensionContext, script: string, document: TextDocument ): Promise<void> {
	const uri = document.uri;
	const folder = workspace.getWorkspaceFolder( uri );
	if ( folder ) {
		const task = await createTask( getPackageManager( context, folder.uri ), script, [ "run-script", script ], folder, uri );
		tasks.executeTask( task );
	}
}

export type StringMap = { [s: string]: string };

export function findScriptAtPosition( document: TextDocument, buffer: string, position: Position ): string | undefined {
	const read = readScripts( document, buffer );
	if ( !read ) {
		return undefined;
	}

	for ( const script of read.scripts ) {
		if ( script.nameRange.start.isBeforeOrEqual( position ) && script.valueRange.end.isAfterOrEqual( position ) ) {
			return script.name;
		}
	}

	return undefined;
}

export async function getScripts( boxJsonUri: Uri ): Promise<IBoxScriptInfo | undefined> {
	if ( boxJsonUri.scheme !== "file" ) {
		return undefined;
	}

	if ( !await exists( boxJsonUri ) ) {
		return undefined;
	}

	try {
		const document: TextDocument = await workspace.openTextDocument( boxJsonUri );
		return readScripts( document );
	} catch ( e ) {
		const parseError = `CommandBox task detection: failed to parse the file ${boxJsonUri.fsPath}`;
		throw new Error( parseError );
	}
}
