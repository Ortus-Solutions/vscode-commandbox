/** @type {import('eslint').Linter.Config} */
module.exports = {
	"env" : {
		"es2021" : true,
		"node"   : true
	},
	"parser"        : "@typescript-eslint/parser",
	"parserOptions" : {
		"sourceType" : "module"
	},
	"plugins" : [
		"jsdoc",
		"@typescript-eslint"
	],
	"rules" : {
		"array-bracket-spacing" : [
			"error",
			"always",
			{
				"singleValue"     : true,
				"arraysInArrays"  : true,
				"objectsInArrays" : true
			}
		],
		"curly"  : "error",
		"eqeqeq" : [
			"error",
			"always"
		],
		"indent" : [
			"error",
			"tab"
		],
		"key-spacing" : [
			"error",
			{
				"singleLine" : {
					"beforeColon" : false,
					"afterColon"  : true
				},
				"multiLine" : {
					"beforeColon" : true,
					"afterColon"  : true,
					"align"       : "colon"
				}
			}
		],
		"keyword-spacing" : [
			"error",
			{
				"after"  : true,
				"before" : true
			}
		],
		"new-parens"         : "error",
		"no-redeclare"       : "error",
		"no-trailing-spaces" : [
			"error",
			{
				"skipBlankLines" : false,
				"ignoreComments" : false
			}
		],
		"no-unused-expressions" : "warn",
		"no-var"                : "error",
		"object-curly-spacing"  : [
			"error",
			"always",
			{
				"objectsInObjects" : true,
				"arraysInObjects"  : true
			}
		],
		"prefer-arrow-callback"        : "error",
		"prefer-const"                 : "warn",
		"prefer-promise-reject-errors" : "off",
		"quotes"                       : [
			"error",
			"double",
			{
				"avoidEscape"           : true,
				"allowTemplateLiterals" : true
			}
		],
		"semi" : [
			"error",
			"always"
		],
		"space-before-function-paren" : [
			"error",
			{
				"anonymous"  : "never",
				"asyncArrow" : "never",
				"named"      : "never"
			}
		],
		"space-in-parens"                                  : [ "error", "always" ],
		"spaced-comment"                                   : "error",
		"jsdoc/check-alignment"                            : "error",
		"jsdoc/check-indentation"                          : "error",
		"jsdoc/newline-after-description"                  : "error",
		"jsdoc/check-param-names"                          : "error",
		"@typescript-eslint/adjacent-overload-signatures"  : "error",
		"@typescript-eslint/array-type"                    : "error",
		"@typescript-eslint/ban-types"                     : "error",
		"@typescript-eslint/consistent-type-assertions"    : "error",
		"@typescript-eslint/explicit-function-return-type" : "error",
		"@typescript-eslint/member-delimiter-style"        : "error",
		"@typescript-eslint/no-empty-interface"            : "error",
		"@typescript-eslint/no-inferrable-types"           : "error",
		"@typescript-eslint/prefer-for-of"                 : "error"
	}
};
