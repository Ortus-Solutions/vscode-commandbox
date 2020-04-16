import {
	TaskDefinition, Task, TaskGroup, WorkspaceFolder, RelativePattern, ShellExecution, Uri, workspace,
	TaskProvider, TextDocument, tasks, TaskScope, QuickPickItem
} from "vscode";
import * as path from "path";
import * as minimatch from "minimatch";
import { JSONVisitor, visit, ParseErrorCode } from "jsonc-parser";

export interface BoxTaskDefinition extends TaskDefinition {
	script: string;
	path?: string;
}

export interface FolderTaskItem extends QuickPickItem {
	label: string;
	task: Task;
}

type AutoDetect = "on" | "off";

let cachedTasks: Task[] | undefined = undefined;

export class BoxTaskProvider implements TaskProvider {

	constructor() {
	}

	public provideTasks() {
		return provideBoxScripts();
	}

	public resolveTask( _task: Task ): Task | undefined {
		if ( "script" in _task.definition ) {
			const kind = _task.definition as BoxTaskDefinition;
			let boxJsonUri: Uri;
			if ( _task.scope === undefined || _task.scope === TaskScope.Global || _task.scope === TaskScope.Workspace ) {
				// scope is required to be a WorkspaceFolder for resolveTask
				return undefined;
			}
			if ( kind.path ) {
				boxJsonUri = _task.scope.uri.with( { path: `${_task.scope.uri.path}/${kind.path}box.json` } );
			} else {
				boxJsonUri = _task.scope.uri.with( { path: `${_task.scope.uri.path}/box.json` } );
			}
			return createTask( kind, `run-script ${kind.script}`, _task.scope, boxJsonUri );
		}
		return undefined;
	}
}

export function invalidateTasksCache() {
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

function getPrePostScripts( scripts: object ): Set<string> {
	const prePostScripts: Set<string> = new Set( [
		"preinstall", "postinstall", "preuninstall", "postuninstall",
		"preversion", "postversion", "prepublish", "postpublish",
		"preunpublish", "postunpublish"
	] );
	const keys = Object.keys( scripts );
	for ( const script of keys ) {
		const prepost = [ "pre" + script, "post" + script ];
		prepost.forEach( each => {
			if ( scripts[each] !== undefined ) {
				prePostScripts.add( each );
			}
		} );
	}
	return prePostScripts;
}

export function isWorkspaceFolder( value: any ): value is WorkspaceFolder {
	return value && typeof value !== "number";
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

async function detectBoxScripts(): Promise<Task[]> {
	const emptyTasks: Task[] = [];
	const allTasks: Task[] = [];
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
						const tasks = await provideBoxScriptsForFolder( path );
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

export async function detectBoxScriptsForFolder( folder: Uri ): Promise<FolderTaskItem[]> {
	const folderTasks: FolderTaskItem[] = [];

	try {
		const relativePattern = new RelativePattern( folder.fsPath, "**/box.json" );
		const paths = await workspace.findFiles( relativePattern );

		const visitedBoxJsonFiles: Set<string> = new Set();
		for ( const path of paths ) {
			if ( !visitedBoxJsonFiles.has( path.fsPath ) ) {
				const tasks = await provideBoxScriptsForFolder( path );
				visitedBoxJsonFiles.add( path.fsPath );
				folderTasks.push( ...tasks.map( t => ( { label: t.name, task: t } ) ) );
			}
		}
		return folderTasks;
	} catch ( error ) {
		return Promise.reject( error );
	}
}

export async function provideBoxScripts(): Promise<Task[]> {
	if ( !cachedTasks ) {
		cachedTasks = await detectBoxScripts();
	}
	return cachedTasks;
}

export function isAutoDetectionEnabled( folder?: WorkspaceFolder ): boolean {
	return workspace.getConfiguration( "commandbox", folder?.uri ).get<AutoDetect>( "autoDetect" ) === "on";
}

function isExcluded( folder: WorkspaceFolder, boxJsonUri: Uri ) {
	function testForExclusionPattern( path: string, pattern: string ): boolean {
		return minimatch( path, pattern, { dot: true } );
	}

	const exclude = workspace.getConfiguration( "commandbox", folder.uri ).get<string | string[]>( "exclude" );
	const boxJsonFolder = path.dirname( boxJsonUri.fsPath );

	if ( exclude ) {
		if ( Array.isArray( exclude ) ) {
			for ( const pattern of exclude ) {
				if ( testForExclusionPattern( boxJsonFolder, pattern ) ) {
					return true;
				}
			}
		} else if ( testForExclusionPattern( boxJsonFolder, exclude ) ) {
			return true;
		}
	}
	return false;
}

async function provideBoxScriptsForFolder( boxJsonUri: Uri ): Promise<Task[]> {
	const emptyTasks: Task[] = [];

	const folder = workspace.getWorkspaceFolder( boxJsonUri );
	if ( !folder ) {
		return emptyTasks;
	}
	const scripts = await getScripts( boxJsonUri );
	if ( !scripts ) {
		return emptyTasks;
	}

	const result: Task[] = [];

	const prePostScripts = getPrePostScripts( scripts );
	Object.keys( scripts ).forEach( each => {
		const task = createTask( each, `run-script ${each}`, folder!, boxJsonUri );
		const lowerCaseTaskName = each.toLowerCase();
		if ( isBuildTask( lowerCaseTaskName, boxJsonUri ) ) {
			task.group = TaskGroup.Build;
		} else if ( isTestTask( lowerCaseTaskName, boxJsonUri ) ) {
			task.group = TaskGroup.Test;
		}
		if ( prePostScripts.has( lowerCaseTaskName ) ) {
			task.group = TaskGroup.Clean; // hack: use Clean group to tag pre/post scripts
		}
		result.push( task );
	} );
	// always add box install (without a problem matcher)
	result.push( createTask( "install", "install", folder, boxJsonUri, [] ) );
	return result;
}

export function getTaskName( script: string, relativePath: string | undefined ) {
	if ( relativePath?.length ) {
		return `${script} - ${relativePath.substring( 0, relativePath.length - 1 )}`;
	}
	return script;
}

export function createTask( script: BoxTaskDefinition | string, cmd: string, folder: WorkspaceFolder, boxJsonUri: Uri, matcher?: string | string[] ): Task {
	let kind: BoxTaskDefinition;
	if ( typeof script === "string" ) {
		kind = { type: "commandbox", script: script };
	} else {
		kind = script;
	}

	function getCommandLine( _folder: WorkspaceFolder, cmd: string ): string {
		const packageManager = "box";

		return `${packageManager} ${cmd}`;
	}

	function getRelativePath( folder: WorkspaceFolder, boxJsonUri: Uri ): string {
		const rootUri = folder.uri;
		const absolutePath = boxJsonUri.path.substring( 0, boxJsonUri.path.length - "box.json".length );
		return absolutePath.substring( rootUri.path.length + 1 );
	}

	const relativeBoxJson = getRelativePath( folder, boxJsonUri );
	if ( relativeBoxJson.length ) {
		kind.path = getRelativePath( folder, boxJsonUri );
	}
	const taskName = getTaskName( kind.script, relativeBoxJson );
	const cwd = path.dirname( boxJsonUri.fsPath );
	return new Task( kind, folder, taskName, "commandbox", new ShellExecution( getCommandLine( folder, cmd ), { cwd: cwd } ), matcher );
}


export function getBoxJsonUriFromTask( task: Task ): Uri | null {
	if ( isWorkspaceFolder( task.scope ) ) {
		if ( task.definition.path ) {
			return Uri.file( path.join( task.scope.uri.fsPath, task.definition.path, "box.json" ) );
		} else {
			return Uri.file( path.join( task.scope.uri.fsPath, "box.json" ) );
		}
	}
	return null;
}

export async function hasBoxJson(): Promise<boolean> {
	const folders = workspace.workspaceFolders;
	if ( !folders ) {
		return false;
	}
	for ( const folder of folders ) {
		if ( folder.uri.scheme === "file" ) {
			const boxJson = path.join( folder.uri.fsPath, "box.json" );
			return exists( Uri.file( boxJson ) );
		}
	}
	return false;
}

async function exists( fileUri: Uri ): Promise<boolean> {
	try {
		await workspace.fs.stat( fileUri );
		return true;
	} catch ( err ) {
		return false;
	}
}

async function readFile( fileUri: Uri ): Promise<string> {
	const readData = await workspace.fs.readFile( fileUri );
	return Buffer.from( readData ).toString( "utf8" );
}

export function runScript( script: string, document: TextDocument ) {
	const uri = document.uri;
	const folder = workspace.getWorkspaceFolder( uri );
	if ( folder ) {
		const task = createTask( script, `run-script ${script}`, folder, uri );
		tasks.executeTask( task );
	}
}

export type StringMap = { [s: string]: string };

async function findAllScripts( buffer: string ): Promise<StringMap> {
	const scripts: StringMap = {};
	let script: string | undefined = undefined;
	let inScripts = false;

	const visitor: JSONVisitor = {
		onError( _error: ParseErrorCode, _offset: number, _length: number ) {
			console.log( _error );
		},
		onObjectEnd() {
			if ( inScripts ) {
				inScripts = false;
			}
		},
		onLiteralValue( value: any, _offset: number, _length: number ) {
			if ( script ) {
				if ( typeof value === "string" ) {
					scripts[script] = value;
				}
				script = undefined;
			}
		},
		onObjectProperty( property: string, _offset: number, _length: number ) {
			if ( property === "scripts" ) {
				inScripts = true;
			} else if ( inScripts && !script ) {
				script = property;
			} else { // nested object which is invalid, ignore the script
				script = undefined;
			}
		}
	};
	visit( buffer, visitor );
	return scripts;
}

export function findAllScriptRanges( buffer: string ): Map<string, [number, number, string]> {
	const scripts: Map<string, [number, number, string]> = new Map();
	let script: string | undefined = undefined;
	let offset: number;
	let length: number;

	let inScripts = false;

	const visitor: JSONVisitor = {
		onError( _error: ParseErrorCode, _offset: number, _length: number ) {
		},
		onObjectEnd() {
			if ( inScripts ) {
				inScripts = false;
			}
		},
		onLiteralValue( value: any, _offset: number, _length: number ) {
			if ( script ) {
				scripts.set( script, [ offset, length, value ] );
				script = undefined;
			}
		},
		onObjectProperty( property: string, off: number, len: number ) {
			if ( property === "scripts" ) {
				inScripts = true;
			} else if ( inScripts ) {
				script = property;
				offset = off;
				length = len;
			}
		}
	};
	visit( buffer, visitor );
	return scripts;
}

export function findScriptAtPosition( buffer: string, offset: number ): string | undefined {
	let script: string | undefined = undefined;
	let foundScript: string | undefined = undefined;
	let inScripts = false;
	let scriptStart: number | undefined;
	const visitor: JSONVisitor = {
		onError( _error: ParseErrorCode, _offset: number, _length: number ) {
		},
		onObjectEnd() {
			if ( inScripts ) {
				inScripts = false;
				scriptStart = undefined;
			}
		},
		onLiteralValue( value: any, nodeOffset: number, nodeLength: number ) {
			if ( inScripts && scriptStart ) {
				if ( typeof value === "string" && offset >= scriptStart && offset < nodeOffset + nodeLength ) {
					// found the script
					inScripts = false;
					foundScript = script;
				} else {
					script = undefined;
				}
			}
		},
		onObjectProperty( property: string, nodeOffset: number ) {
			if ( property === "scripts" ) {
				inScripts = true;
			} else if ( inScripts ) {
				scriptStart = nodeOffset;
				script = property;
			} else { // nested object which is invalid, ignore the script
				script = undefined;
			}
		}
	};
	visit( buffer, visitor );
	return foundScript;
}

export async function getScripts( boxJsonUri: Uri ): Promise<StringMap | undefined> {
	if ( boxJsonUri.scheme !== "file" ) {
		return undefined;
	}

	if ( !await exists( boxJsonUri ) ) {
		return undefined;
	}

	try {
		const contents = await readFile( boxJsonUri );
		const json = findAllScripts( contents );
		return json;
	} catch ( e ) {
		const parseError = `CommandBox task detection: failed to parse the file ${boxJsonUri.fsPath}`;
		throw new Error( parseError );
	}
}
