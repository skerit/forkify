var spawn = require('child_process').spawn,
    utils = require('./utils'),
    fork = require('child_process').fork,
    dry = require('./json-dry');

function ForkifyCreator() {

	var instances = [],
	    functions = [],
	    callbacks = [],
	    ordered = [],
	    bufferid = 0;

	// Instances limit, 3 by default
	forkify.limit = 3;

	// How long can instances be idle, 30 seconds by default
	forkify.idle = 30000;

	// Create a link to the constructor
	forkify.constructor = ForkifyCreator;

	/**
	 * Reap old forks
	 *
	 * @author   Jelle De Loecker   <jellekipdola.be>
	 * @since    0.1.1
	 * @version  0.1.1
	 */
	setInterval(function reap() {

		var instance,
		    now,
		    i;

		now = Date.now();

		for (i = 0; i < instances.length; i++) {
			instance = instances[i];

			if (!instance) {
				continue;
			}

			if (!instance.running && (now - instance.idle_since) > forkify.idle) {
				instances[i] = null;
				instance.kill();
			}
		}
	}, 10000).unref();

	/**
	 * Wrap/asyncify/forkify a function
	 *
	 * @author   Jelle De Loecker   <jellekipdola.be>
	 * @since    0.1.0
	 * @version  0.1.0
	 *
	 * @param    {Function}   fnc
	 *
	 * @return   {Function}
	 */
	function forkify(fnc) {

		var id = functions.push(fnc) - 1,
		    source = ''+fnc;

		// Store the id in the array
		fnc._wrapid = id;

		// Prepare an instance
		function prepareInstance() {

			var instance = forkify.getInstance();

			// Send the function to the instance if it doesn't have it yet
			if (!instance.readyFncs[id]) {
				instance.send({type: 'wrap', fnc: source, id: id});
			}

			return instance;
		}

		// Return a wrapper function
		return function forkified() {

			var instance = prepareInstance(),
			    buffers = [],
			    tasks = [],
			    buffer,
			    data,
			    args,
			    cbid,
			    len,
			    cb,
			    i;

			// Get the number of arguments to pass
			len = arguments.length;

			// Get the supposed callback argument
			cb = arguments[len - 1];

			// If the last argument is a function, add it to the callback array
			if (typeof cb == 'function') {

				// Tell the callback from which instance it comes
				cb.fromInstanceId = instance.id;

				// Get the callback id
				cbid = callbacks.push(cb) - 1;
				len--;
			}

			// Create the args array
			args = new Array(len);

			// Turn the arguments object into an array
			for (i = 0; i < len; i++) {
				args[i] = arguments[i];
			}

			// Stringify the arguments using JSON-dry
			args = dry.dry(args);

			// See if there were any buffers inside the arguments
			for (i = 0; i < args.buffers.length; i++) {
				buffer = args.buffers[i];
				buffer.bufferid = bufferid++;
				buffers.push({bufferid: buffer.bufferid, length: buffer.length});
			}

			data = {
				type: 'exec',
				fncid: id,
				cbid: cbid,
				args: args.string,
				buffers: buffers
			};

			// Increase the running count
			instance.running++;

			// Send the exec request to the worker
			instance.send(data);

			if (!args.buffers.length) {
				return;
			}

			// Already say the client side's buffer stream is locked,
			// so new requests can be sent to other instances
			instance.forkBufferlock = true;

			// Send the buffers once the fork is ready
			args.buffers.forEach(function eachBuffer(buffer, index) {
				instance.once('ready-for-buffer-' + buffer.bufferid, function sendBuffer() {
					instance.stream.write(buffer);
				});
			});
		};
	}

	/**
	 * Handle callback
	 *
	 * @author   Jelle De Loecker   <jellekipdola.be>
	 * @since    0.1.0
	 * @version  0.1.0
	 */
	function handleCallback(cbid, response) {

		var cb = callbacks[cbid];

		if (!cb) {
			return;
		}

		callbacks[cbid] = null;

		cb.apply(null, response);
	}

	/**
	 * Create a new instance
	 *
	 * @author   Jelle De Loecker   <jellekipdola.be>
	 * @since    0.1.0
	 * @version  0.1.0
	 */
	forkify.addInstance = function addInstance() {

		var instance,
		    options,
		    id = instances.length;

		options = {
			stdio: ['ipc', process.stdout, process.stderr, 'pipe']
		};

		// Create the instance
		instance = spawn('node', [__dirname + '/fork.js', id], options);

		// Don't let the forked process keep this parent running
		instance.unref();

		// Set the bufferlock
		instance.bufferlock = false;

		// The functions waiting for buffers
		instance.waiters = [];

		// Set the buffer function handler
		instance.waitForBuffers = utils.waitForBuffers;

		// Create a reference to the stream
		instance.stream = instance.stdio[3];
		instance.stream.unref();

		// Last time we got a message from the instance
		instance.updated_on = Date.now();

		// Last execution
		instance.idle_since = instance.updated_on;

		// Set the lag
		instance.lag = 0;

		// Set the ready functions
		instance.readyFncs = {};

		// Set the toobusy function
		instance.toobusy = function toobusy() {
			return Math.random() < (instance.lag - 70) / 70;
		};

		// Instance running functions
		instance.running = 0;

		// Add a listener
		instance.on('message', function onForkMessage(msg) {

			instance.updated_on = Date.now();

			switch (msg.type) {

				case 'callback':
					instance.running--;
					instance.idle_since = Date.now();

					if (msg.buffers.length) {
						instance.waitForBuffers(msg, function gotWithBuffers(err, response) {
							handleCallback(msg.cbid, response);
						});
					} else {
						handleCallback(msg.cbid, dry.undry(msg.response));
					}
					break;

				case 'ping':
					instance.lag = msg.lag;
					instance.forkBufferlock = msg.bufferlock;
					break;

				case 'event':
					instance.emit(msg.name);
					break;

				default:
					console.log('Unknown instance message:', msg);
			}
		});

		/**
		 * If we can receive buffers, set the next listener
		 *
		 * @author   Jelle De Loecker   <jellekipdola.be>
		 * @since    0.1.1
		 * @version  0.1.1
		 */
		instance.on('can-receive-buffers', function onCanReceiveBuffers() {
			var fnc = instance.waiters.shift();
			if (fnc) fnc();
		});

		/**
		 * Listen to the readable stream and pass chunks
		 * to the aggregator if it's set
		 *
		 * @author   Jelle De Loecker   <jellekipdola.be>
		 * @since    0.1.1
		 * @version  0.1.1
		 */
		instance.stream.on('data', function gotData(chunk) {
			if (instance.aggregator) instance.aggregator(chunk);
		});

		instance.id = id;

		instances.push(instance);
		ordered.push(instance);

		return instance;
	};

	/**
	 * Function userd by Array#sort to sort instances
	 *
	 * @author   Jelle De Loecker   <jellekipdola.be>
	 * @since    0.1.0
	 * @version  0.1.0
	 */
	function sortInstances(a, b) {

		var alag,
		    blag;

		if (a.lag < 3) {
			alag = 0;
		}

		if (b.lag < 3) {
			blag = 0;
		}

		// Sort by running count if lag is the same
		if (blag == alag) {
			return a.running - b.running;
		}

		return alag - blag;
	}

	/**
	 * Get an instance
	 *
	 * @author   Jelle De Loecker   <jellekipdola.be>
	 * @since    0.1.0
	 * @version  0.1.0
	 */
	forkify.getInstance = function getInstance() {

		var instance,
		    found,
		    i;

		if (!instances.length) {
			instance = forkify.addInstance();
			found = true;
		} else {

			ordered.sort(sortInstances);

			for (i = 0; i < ordered.length; i++) {
				instance = ordered[i];

				// If the instance hasn't locked the buffer stream  on its side
				// and it isn't too busy, see if we can use it
				if (!instance.forkBufferlock && !instance.toobusy()) {

					// If 10 commands are running and only 1 instance has been made, break
					if (instance.running > 10 && instances.length < 2) {
						break;
					}

					found = true;
					break;
				}
			}
		}

		if (!found && instances.length < forkify.limit) {
			return forkify.addInstance();
		}

		instance.idle_since = Date.now();

		return instance;
	};

	return forkify;
}

module.exports = ForkifyCreator();