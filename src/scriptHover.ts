import {
	ExtensionContext, TextDocument, commands, ProviderResult, CancellationToken,
	workspace, tasks, HoverProvider, Hover, Position, MarkdownString, Uri
} from "vscode";
import { IBoxScriptInfo, readScripts } from "./readScripts";
import {
	createTask, getPackageManager
} from "./tasks";

let cachedDocument: Uri | undefined = undefined;
let cachedScripts: IBoxScriptInfo | undefined = undefined;

export function invalidateHoverScriptsCache( document?: TextDocument ): void {
	if ( !document ) {
		cachedDocument = undefined;
		return;
	}
	if ( document.uri === cachedDocument ) {
		cachedDocument = undefined;
	}
}

export class BoxScriptHoverProvider implements HoverProvider {
	private enabled: boolean;

	constructor( private context: ExtensionContext ) {
		context.subscriptions.push( commands.registerCommand( "commandbox.runScriptFromHover", this.runScriptFromHover, this ) );
		context.subscriptions.push( workspace.onDidChangeTextDocument( ( e ) => {
			invalidateHoverScriptsCache( e.document );
		} ) );

		const isEnabled = (): boolean => workspace.getConfiguration( "commandbox" ).get<boolean>( "scriptHover" , true );
		this.enabled = isEnabled();
		context.subscriptions.push( workspace.onDidChangeConfiguration( ( e ) => {
			if ( e.affectsConfiguration( "commandbox.scriptHover" ) ) {
				this.enabled = isEnabled();
			}
		} ) );
	}

	public provideHover( document: TextDocument, position: Position, _token: CancellationToken ): ProviderResult<Hover> {
		let hover: Hover | undefined = undefined;

		if ( !this.enabled ) {
			return hover;
		}

		if ( cachedDocument?.fsPath !== document.uri.fsPath ) {
			cachedScripts = readScripts( document );
			cachedDocument = document.uri;
		}

		cachedScripts?.scripts.forEach( ( { name, nameRange } ) => {
			if ( nameRange.contains( position ) ) {
				const contents: MarkdownString = new MarkdownString();
				contents.isTrusted = true;
				contents.appendMarkdown( this.createRunScriptMarkdown( name, document.uri ) );
				hover = new Hover( contents );
			}
		} );

		return hover;
	}

	private createRunScriptMarkdown( script: string, documentUri: Uri ): string {
		const args = {
			documentUri : documentUri,
			script      : script,
		};
		return this.createMarkdownLink(
			"Run Script",
			"commandbox.runScriptFromHover",
			args,
			"Run the script as a task"
		);
	}

	private createMarkdownLink( label: string, cmd: string, args: any, tooltip: string, separator?: string ): string {
		const encodedArgs = encodeURIComponent( JSON.stringify( args ) );
		let prefix = "";
		if ( separator ) {
			prefix = ` ${separator} `;
		}
		return `${prefix}[${label}](command:${cmd}?${encodedArgs} "${tooltip}")`;
	}

	public async runScriptFromHover( args: { script: string; documentUri: Uri } ): Promise<void> {
		const folder = workspace.getWorkspaceFolder( args.documentUri );
		if ( folder ) {
			const task = await createTask( getPackageManager( this.context, folder.uri ), args.script, [ "run-script", args.script ], folder, args.documentUri );
			tasks.executeTask( task );
		}
	}
}
