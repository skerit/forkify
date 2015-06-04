# Forkify

Forkify lets you run functions in a forked child process

## Install

```bash
$ npm install forkify
```

## Features

* Distribute executions over multiple instances
* Create new instances when existing ones are too busy
* Buffers & streams are sent over a separate socket
  to bypass costly JSON serialization
* Idle instances are reaped (by default after 30 seconds)
* Events can be emitted from the fork

## Todo

* You should also be able to send events to the fork
* Emitted event arguments should be serialized through the same process as
  a function execution or callback, so buffers & streams can also be emitted

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

### Work with buffers

You can pass Buffer instances back and forth, without problems.
These are not serialized using JSON, as that is a costly affair.
Unfortunately, they are also not using "shared memory", rather the buffer contents are sent to the child over an extra stream.

```javascript

var workWithBuffers = forkify(function(buffer, callback) {

    // Outputs 6 in this case
    console.log(buffer.length);

    callback(null, new Buffer(40));
});

workWithBuffers(new Buffer(6), function(err, buffer) {
    // Outputs 40 in this case
    console.log(buffer.length);
});
```

### Set instance pool size

By default, up to 3 instances are created. This can be modified at any time like this:

```javascript
forkify.limit = 5;
```

### Create a new forkify pool

If you want to create a separate pool, you can do so like this:

```javascript
var forkify2 = forkify.constructor();
```

### Set minimum idle time before reaping

Forks are killed after idling for at least 30 seconds.
This can be changed by setting the `idle` property:

```javascript
forkify.idle = 45000; // 45 seconds
```

Do note: For now, the reaping function only runs once every 10 seconds.

## Caveats

`forkify` functions run in a new scope and can not access anything outside of it, you will have to re-`require` modules you wish to use inside the function.

Arguments passed to the forkified function are converted using a modified version of JSON-DRY (which supports Dates, Infinity, Errors, Buffers, ...)

Because of the addition of Buffer support `forkify` will keep your application running until all instances have been reaped.

## License

MIT