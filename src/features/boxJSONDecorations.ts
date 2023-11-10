import * as vscode from "vscode";
import { parse } from '@typescript-eslint/parser'
import { TSESTree } from '@typescript-eslint/types'
import { VariableDeclaration } from '@typescript-eslint/types/dist/generated/ast-spec'
import * as forgeboxAPI from "../forgeboxAPI";
import * as semver from "semver";

type Decoration = {
    lineNumber: number,
    type: vscode.TextEditorDecorationType
};

type DependencyLine = {
    line: vscode.TextLine,
    name: string,
    currentVersion: string
}

let drawnDecorations: Record<number, Decoration> = {};

let forgeboxCache: Record<string, string> = {};

const darkThemeDefaults : Record<semver.ReleaseType,string> = {
    major: "red",
    premajor: "red",
    minor: "yellow",
    preminor: "yellow",
    patch: "green",
    prepatch: "green",
    prerelease: "green"
};

const lightThemeDefaults : Record<semver.ReleaseType,string> = {
    major: "darkred",
    premajor: "darkred",
    minor: "darkorange",
    preminor: "darkorange",
    patch: "darkgreen",
    prepatch: "darkgreen",
    prerelease: "darkgreen"
};

export async function decorateBoxJSON(textEditor: vscode.TextEditor | undefined) {
    console.log( 'running' );
    if (textEditor == undefined) {
        return;
    }

    if( !textEditor.document.fileName.endsWith( 'box.json' ) ){
        return;
    }

    const linesWithDecorations = await Promise.all( getDependencyLines( textEditor.document ).map( async ( dependencyLine: DependencyLine ) => {
        return [ dependencyLine, await getDecoration( dependencyLine ) ];
    }));

    linesWithDecorations.forEach( ( [ dependencyLine, decoration ] ) => {
        decorateLine( textEditor, ( dependencyLine as DependencyLine).line.lineNumber, (decoration as vscode.DecorationRenderOptions) );
    });
}

async function getDecoration( dependencyLine: DependencyLine ) : Promise<vscode.DecorationRenderOptions> {
    const forgeBoxVersion = await getForgeBoxVersion( dependencyLine.name );

    if( forgeBoxVersion == null ){
        return {
            after: {
                color: "gray",
                margin: "2em",
                contentText: "Unable to retrieve package information"
            }
        };
    }

    console.log( forgeBoxVersion );

    if( semver.satisfies( semver.minVersion( forgeBoxVersion ), dependencyLine.currentVersion ) ){
        return {
            after: {
                color: "gray",
                margin: "2em",
                contentText: `matches the latest version ${forgeBoxVersion}`
            }
        };
    }


    const diff = semver.diff( semver.minVersion( dependencyLine.currentVersion ), semver.minVersion( forgeBoxVersion ) );

    return {
        light: { after: { color: getColor( diff, lightThemeDefaults ) } },
        dark: { after: { color: getColor( diff, darkThemeDefaults ) } },
        after: {
            margin: "2em",
            contentText: forgeBoxVersion
        }
    };
}

async function getForgeBoxVersion( slug: string ): Promise<string | null> {
    console.log( "getting version for " + slug );

    if( forgeboxCache[ slug ] ){
        console.log( 'grabbing slug from cache' );
        return forgeboxCache[ slug ];
    }

    console.log( 'cache miss' );

    const packageInfo = await forgeboxAPI.getPackageInfo( slug );

    if( packageInfo instanceof forgeboxAPI.ForgeBoxError ){
        return null;
    }

    packageInfo;

    forgeboxCache[ slug ] = packageInfo.latestVersion.version;
    console.log( 'updating cache with: ' + forgeboxCache[ slug ] );
    return forgeboxCache[ slug ];
}

function decorateLine( textEditor: vscode.TextEditor, lineNumber: number, decorationOptions: vscode.DecorationRenderOptions ){
    const decoration = drawnDecorations[ lineNumber ];

    if( decoration != null ){
        decoration.type.dispose();
    }

    const newDecoration = {
        lineNumber,
        type: vscode.window.createTextEditorDecorationType(decorationOptions)
    };

    const line = textEditor.document.lineAt( lineNumber );

    textEditor.setDecorations( newDecoration.type, [
        new vscode.Range( line.range.end, line.range.end )
    ]);

    drawnDecorations[ lineNumber ] = newDecoration;
}

export const getDependencyLines = (textDocument: vscode.TextDocument) : DependencyLine[] => {
    const jsonAsTypescript = `let tmp=${textDocument.getText()}`

    const ast = parse(jsonAsTypescript, {
      loc: true,
    })

    const variable = ast.body[0] as VariableDeclaration

    const tmp = variable.declarations[0]

    const init = tmp.init
    if (init == null || init.type !== 'ObjectExpression') {
      throw new Error(`unexpected type: ${init?.type}`)
    }

    const properties = init.properties as TSESTree.Property[]

    const dependencies = properties.find(
      (p) => (p.key as TSESTree.StringLiteral).value.toLowerCase() === 'dependencies',
    )

    const devDependencies = properties.find(
      (p) => (p.key as TSESTree.StringLiteral).value.toLowerCase() === 'devdependencies',
    )

    return [
        ...extractDependencyLines( textDocument, dependencies ),
        ...extractDependencyLines( textDocument, devDependencies )
    ];
}

function extractDependencyLines( textDocument, dependencyProperty ){
    if (dependencyProperty.value.type !== 'ObjectExpression') {
        return [];
    }

    return dependencyProperty.value.properties.map( ( dependency ) => {
        return {
            line: textDocument.lineAt( dependency.loc.end.line - 1 ),
            name: dependency.key.value,
            currentVersion: dependency.value.value
        };
    });
}

function getColor( versionDiff: semver.ReleaseType, colorThemeDefaults ) : string {

    if( versionDiff === 'major' || versionDiff === "premajor" ){
        const colorOverride = vscode.workspace.getConfiguration( "commandbox.box" ).get<string | null>( "majorUpdateColor" );

        if( colorOverride ){
            return colorOverride;
        }
    }
    else if( versionDiff === 'minor' || versionDiff === "preminor" ){
        const colorOverride = vscode.workspace.getConfiguration( "commandbox.box" ).get<string | null>( "minorUpdateColor" );

        if( colorOverride ){
            return colorOverride;
        }
    }
    else if( versionDiff === 'patch' || versionDiff === "prepatch" || versionDiff === "prerelease" ){
        const colorOverride = vscode.workspace.getConfiguration( "commandbox.box" ).get<string | null>( "patchUpdateColor" );

        if( colorOverride ){
            return colorOverride;
        }
    }

    return colorThemeDefaults[ versionDiff ] ? colorThemeDefaults[ versionDiff ] : "gray";
}