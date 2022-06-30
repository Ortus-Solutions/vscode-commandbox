import { JSONVisitor, visit } from "jsonc-parser";
import { Location, Position, Range, TextDocument } from "vscode";

export interface IBoxScriptReference {
	name: string;
	value: string;
	nameRange: Range;
	valueRange: Range;
}

export interface IBoxScriptInfo {
	location: Location;
	scripts: IBoxScriptReference[];
}

export const readScripts = ( document: TextDocument, buffer = document.getText() ): IBoxScriptInfo | undefined => {
	let start: Position | undefined;
	let end: Position | undefined;
	let inScripts = false;
	let buildingScript: { name: string; nameRange: Range } | void;
	let level = 0;

	const scripts: IBoxScriptReference[] = [];
	const visitor: JSONVisitor = {
		onError() {
			// no-op
		},
		onObjectBegin() {
			level++;
		},
		onObjectEnd( offset ) {
			if ( inScripts ) {
				end = document.positionAt( offset );
				inScripts = false;
			}
			level--;
		},
		onLiteralValue( value: unknown, offset: number, length: number ) {
			if ( buildingScript && typeof value === "string" ) {
				scripts.push( {
					...buildingScript,
					value,
					valueRange : new Range( document.positionAt( offset ), document.positionAt( offset + length ) ),
				} );
				buildingScript = undefined;
			}
		},
		onObjectProperty( property: string, offset: number, length: number ) {
			if ( level === 1 && property === "scripts" ) {
				inScripts = true;
				start = document.positionAt( offset );
			} else if ( inScripts ) {
				buildingScript = {
					name      : property,
					nameRange : new Range( document.positionAt( offset ), document.positionAt( offset + length ) )
				};
			}
		},
	};

	visit( buffer, visitor );

	if ( start === undefined ) {
		return undefined;
	}

	return { location: new Location( document.uri, new Range( start, end ?? start ) ), scripts };
};
