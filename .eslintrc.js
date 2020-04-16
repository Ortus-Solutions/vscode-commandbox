module.exports = {
	"env": {
		"es2017": true,
		"node": true
	},
	"parser": "@typescript-eslint/parser",
	"parserOptions": {
		"sourceType": "module"
	},
	"plugins": [
		"jsdoc",
		"@typescript-eslint"
	],
	"rules": {
		"array-bracket-spacing": [
			"error",
			"always",
			{
				"singleValue": true,
				"arraysInArrays": true,
				"objectsInArrays": true
			}
		],
		"curly": "error",
		"eqeqeq": [
			"error",
			"always"
		],
		"indent": [
			"error",
			"tab"
		],
		"key-spacing": [
			"error",
			{
				"singleLine": {
					"beforeColon": false,
					"afterColon": true
				},
				"multiLine": {
					"beforeColon": true,
					"afterColon": true,
					"align": "colon"
				}
			}
		],
		"keyword-spacing": [
			"error",
			{
				"after": true,
				"before": true
			}
		],
		"new-parens": "error",
		"no-redeclare": "error",
		"no-trailing-spaces": [
			"error",
			{
				"skipBlankLines": false,
				"ignoreComments": false
			}
		],
		"no-unused-expressions": "warn",
		"no-var": "error",
		"object-curly-spacing": [
			"error",
			"always",
			{
				"objectsInObjects": true,
				"arraysInObjects": true
			}
		],
		"prefer-arrow-callback": "error",
		"prefer-const": "warn",
		"prefer-promise-reject-errors": "off",
		"quotes": [
			"error",
			"double",
			{
				"avoidEscape": true,
				"allowTemplateLiterals": true
			}
		],
		"semi": [
			"error",
			"always"
		],
		"space-before-function-paren": [
			"error",
			{
				"anonymous": "never",
				"asyncArrow": 'never',
				"named": "never"
			}
		],
		"space-in-parens": ["error", "always"],
		"spaced-comment": "error",
		"jsdoc/check-alignment": "error",
		"jsdoc/check-indentation": "error",
		"jsdoc/newline-after-description": "error",
		"jsdoc/check-param-names": "error",
		"@typescript-eslint/adjacent-overload-signatures": "error",
		"@typescript-eslint/array-type": "error",
		"@typescript-eslint/class-name-casing": "error",
		"@typescript-eslint/member-delimiter-style": [
			"error",
			{
				"multiline": {
					"delimiter": "semi",
					"requireLast": true
				},
				"singleline": {
					"delimiter": "semi",
					"requireLast": false
				}
			}
		],
		"@typescript-eslint/no-explicit-any": "warn",
		"@typescript-eslint/prefer-for-of": "error"
	}
};
