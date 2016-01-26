Port to ES6

Investigate
* [template strings](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/template_strings)
* [ES6 Map](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map) for the template resolvers?
* [Promises](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) for rendering?

Add special `{{.}}` syntax for passing raw string as context.

Add array syntax. Draft:
    {{@artists:artist}}
		<span>{{artist}}</span>
	{{/@artists}}
