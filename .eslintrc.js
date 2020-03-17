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
		"curly": "error",
		"eqeqeq": [
			"error",
			"always"
		],
		"indent": [
			"error",
			"tab"
		],
		"new-parens": "error",
		"no-redeclare": "error",
		"no-trailing-spaces": "error",
		"no-unused-expressions": "warn",
		"no-var": "error",
		"prefer-arrow-callback": "error",
		"prefer-const": "warn",
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
				"anonymous": "always",
				"named": "never"
			}
		],
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
