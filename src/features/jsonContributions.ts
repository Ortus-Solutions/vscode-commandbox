import { Location, getLocation, createScanner, SyntaxKind, ScanError, JSONScanner } from "jsonc-parser";
import { BoxJSONContribution } from "./boxJSONContribution";
import { XHRRequest } from "request-light";
import {
	CompletionItem, CompletionItemProvider, CompletionList, TextDocument, Position, Hover, HoverProvider,
	CancellationToken, Range, MarkdownString, DocumentSelector, languages, Disposable, Uri
} from "vscode";

export interface ISuggestionsCollector {
	add( suggestion: CompletionItem ): void;
	error( message: string ): void;
	log( message: string ): void;
	setAsIncomplete(): void;
}

export interface IJSONContribution {
	getDocumentSelector(): DocumentSelector;
	getInfoContribution( resourceUri: Uri, location: Location ): Promise<MarkdownString[] | null> | null;
	collectPropertySuggestions( resourceUri: Uri, location: Location, currentWord: string, addValue: boolean, isLast: boolean, result: ISuggestionsCollector ): Promise<any> | null;
	collectValueSuggestions( resourceUri: Uri, location: Location, result: ISuggestionsCollector ): Promise<any>;
	collectDefaultSuggestions( resourceUri: Uri, result: ISuggestionsCollector ): Promise<null>;
	resolveSuggestion?( resourceUri: Uri | undefined, item: CompletionItem ): Promise<CompletionItem | null> | null;
}

export function addJSONProviders( xhr: XHRRequest ): Disposable {
	const contributions = [ new BoxJSONContribution( xhr ) ];
	const subscriptions: Disposable[] = [];
	contributions.forEach( contribution => {
		const selector = contribution.getDocumentSelector();
		subscriptions.push( languages.registerCompletionItemProvider( selector, new JSONCompletionItemProvider( contribution ), '"', ":" ) );
		subscriptions.push( languages.registerHoverProvider( selector, new JSONHoverProvider( contribution ) ) );
	} );
	return Disposable.from( ...subscriptions );
}

export class JSONHoverProvider implements HoverProvider {

	constructor( private jsonContribution: IJSONContribution ) {
	}

	public async provideHover( document: TextDocument, position: Position, _token: CancellationToken ): Promise<Hover> | null {
		const offset = document.offsetAt( position );
		const location = getLocation( document.getText(), offset );
		if ( !location.previousNode ) {
			return null;
		}
		const node = location.previousNode;
		if ( node && node?.offset <= offset && offset <= node.offset + node.length ) {
			const promise = this.jsonContribution.getInfoContribution( document.uri, location );
			if ( promise ) {
				const htmlContent = await promise;
				const range = new Range( document.positionAt( node.offset ), document.positionAt( node.offset + node.length ) );
				const result: Hover = {
					contents : htmlContent || [],
					range    : range
				};
				return result;
			}
		}
		return null;
	}
}

export class JSONCompletionItemProvider implements CompletionItemProvider {

	private lastResource: Uri | undefined;

	constructor( private jsonContribution: IJSONContribution ) {
	}

	public async resolveCompletionItem( item: CompletionItem, _token: CancellationToken ): Promise<CompletionItem | null> {
		if ( this.jsonContribution.resolveSuggestion ) {
			const resolver = this.jsonContribution.resolveSuggestion( this.lastResource, item );
			if ( resolver ) {
				return resolver;
			}
		}
		return item;
	}

	public async provideCompletionItems( document: TextDocument, position: Position, _token: CancellationToken ): Promise<CompletionList | null> | null {
		this.lastResource = document.uri;
		const currentWord = this.getCurrentWord( document, position );
		let overwriteRange: Range;

		const items: CompletionItem[] = [];
		let isIncomplete = false;

		const offset = document.offsetAt( position );
		const location = getLocation( document.getText(), offset );

		const node = location.previousNode;
		if ( node && node.offset <= offset && offset <= node.offset + node.length && ( node.type === "property" || node.type === "string" || node.type === "number" || node.type === "boolean" || node.type === "null" ) ) {
			overwriteRange = new Range( document.positionAt( node.offset ), document.positionAt( node.offset + node.length ) );
		} else {
			overwriteRange = new Range( document.positionAt( offset - currentWord.length ), position );
		}

		const proposed: { [key: string]: boolean } = {};
		const collector: ISuggestionsCollector = {
			add : ( suggestion: CompletionItem ) => {
				const key = typeof suggestion.label === "string" ? suggestion.label : suggestion.label.label;
				if ( !proposed[key] ) {
					proposed[key] = true;
					suggestion.range = { replacing: overwriteRange, inserting: new Range( overwriteRange.start, overwriteRange.start ) };
					items.push( suggestion );
				}
			},
			setAsIncomplete : () => isIncomplete = true,
			error           : ( message: string ) => console.error( message ),
			log             : ( message: string ) => console.log( message )
		};

		let collectPromise: Promise<any> | null = null;

		if ( location.isAtPropertyKey ) {
			const scanner = createScanner( document.getText(), true );
			const addValue = !location.previousNode || !this.hasColonAfter( scanner, location.previousNode.offset + location.previousNode.length );
			const isLast = this.isLast( scanner, document.offsetAt( position ) );
			collectPromise = this.jsonContribution.collectPropertySuggestions( document.uri, location, currentWord, addValue, isLast, collector );
		} else {
			if ( location.path.length === 0 ) {
				collectPromise = this.jsonContribution.collectDefaultSuggestions( document.uri, collector );
			} else {
				collectPromise = this.jsonContribution.collectValueSuggestions( document.uri, location, collector );
			}
		}
		if ( collectPromise ) {
			await collectPromise;
			if ( items.length > 0 || isIncomplete ) {
				return new CompletionList( items, isIncomplete );
			}
		}
		return null;
	}

	private getCurrentWord( document: TextDocument, position: Position ): string {
		let i = position.character - 1;
		const text = document.lineAt( position.line ).text;
		while ( i >= 0 && ' \t\n\r\v":{[,'.indexOf( text.charAt( i ) ) === -1 ) {
			i--;
		}
		return text.substring( i + 1, position.character );
	}

	private isLast( scanner: JSONScanner, offset: number ): boolean {
		scanner.setPosition( offset );
		let nextToken = scanner.scan();
		if ( nextToken === SyntaxKind.StringLiteral && scanner.getTokenError() === ScanError.UnexpectedEndOfString ) {
			nextToken = scanner.scan();
		}
		return nextToken === SyntaxKind.CloseBraceToken || nextToken === SyntaxKind.EOF;
	}

	private hasColonAfter( scanner: JSONScanner, offset: number ): boolean {
		scanner.setPosition( offset );
		return scanner.scan() === SyntaxKind.ColonToken;
	}
}
