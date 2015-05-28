# Forkify

Forkify lets you run functions in a forked child process

## Install

```bash
$ npm install forkify
```

## Features

* Distribute executions over multiple instances
* Create new instances when existing ones are too busy

## Examples

### Forkify a function

```javascript
var forkify = require('forkify');

// Forkify the function
var fibonacci = forkify(function generateFibonacci(amount, callback) {
    var fib = [],
        res,
        i;

    fib[0] = 0;
    fib[1] = 1;

    for (i = 2; i <= amount; i++) {
        res = fib[0] + fib[1];

        fib[0] = fib[1];
        fib[1] = res;
    }

    // Callback with the response
    callback(null, res);
});

fibonacci(10, function gotResult(err, result) {
    console.log('Fibonacci result:', err, result);
});

```

### Set instance pool size

By default, up to 3 instances are created. This can be modified at any time like this:

```javascript
var forkify = require('forkify');
forkify.limit = 5;
```

### Create a new forkify pool

If you want to create a separate pool, you can do so like this:

```javascript
var forkify = require('forkify');
var forkify2 = forkify.constructor();
```

## Caveats

`forkify` functions run in a new scope and can not access anything outside of it, you will have to re-`require` modules you wish to use inside the function.

Arguments passed to the forkified function are converted using JSON-dry (which supports Dates, Infinity, Errors, ...)

## License

MIT