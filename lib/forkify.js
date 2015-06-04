var utils = require('./utils'),
    fork = require('child_process').fork,
    dry = require('./json-dry'),
    EventEmitter = require('events').EventEmitter;

var net = require('net');

function ForkifyCreator() {

	var instances = [],
	    functions = [],
	    callbacks = [],
	    ordered = [],
	    bufferid = 0,
	    forks = 0;

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
	 * @version  0.1.2
	 */
	setInterval(function reap() {

		var instance,
		    now,
		    i;

		now = Date.now();
		ordered = [];

		for (i = 0; i < instances.length; i++) {
			instance = instances[i];

			if (!instance) {
				continue;
			}

			if (!instance.connected || (!instance.running && (now - instance.idle_since) > forkify.idle)) {
				forks--;
				instances[i] = null;
				instance.kill();
			} else {
				ordered.push(instance);
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
			    streams = [],
			    tasks = [],
			    buffer,
			    stream,
			    event,
			    data,
			    args,
			    cbid,
			    len,
			    cb,
			    i;

			event = new EventEmitter();

			// Get the number of arguments to pass
			len = arguments.length;

			// Get the supposed callback argument
			cb = arguments[len - 1];

			// If the last argument is a function, add it to the callback array
			if (typeof cb == 'function') {

				// Tell the callback from which instance it comes
				cb.fromInstanceId = instance.id;

				len--;
			}

			// Get the callback id, even if there is none
			cbid = callbacks.push(cb) - 1;

			instance.on('fnc-exec-event-' + cbid, function gotEvent(packet) {
				console.log('Got event', packet)
				event.emit.apply(event, [packet.type].concat(packet.args));
			});

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
				buffer.bufferid = '/tmp/forkify-b-' + Date.now() + '-' + bufferid++;
				buffers.push({bufferid: buffer.bufferid, length: buffer.length});
			}

			// See if there were any streams inside the arguments
			for (i = 0; i < args.streams.length; i++) {
				stream = args.streams[i];
				stream.streamid = '/tmp/forkify-s-' + Date.now() + '-' + bufferid++;
				streams.push({streamid: stream.streamid});
			}

			data = {
				type: 'exec',
				fncid: id,
				cbid: cbid,
				args: args.string,
				buffers: buffers,
				streams: streams
			};

			// Increase the running count
			instance.running++;

			// Send the exec request to the worker if no buffers are requested
			if (!buffers.length && !streams.length) {
				instance.send(data);
				return;
			}

			if (buffers.length) {
				tasks.push(function doBuffers(next) {
					utils.sendBuffers(args.buffers, next);
				});
			}

			if (streams.length) {
				tasks.push(function doStreams(next) {
					utils.sendStreams(args.streams, next);
				});
			}

			utils.parallel(tasks, function done() {
				console.log('sending data');
				instance.send(data);
			});

			return event;
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
	 * @version  0.1.3
	 */
	forkify.addInstance = function addInstance() {

		var instance,
		    id = instances.length;

		// Create the instance
		instance = fork(__dirname + '/fork.js', [id]);

		// Don't let the forked process keep this parent running
		instance.unref();

		// Set the bufferlock
		instance.bufferlock = false;

		// The functions waiting for buffers
		instance.waiters = [];

		// Set the buffer function handler
		instance.waitForBuffers = utils.waitForBuffers;

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

			var tasks = [];

			instance.updated_on = Date.now();

			switch (msg.type) {

				case 'callback':
					instance.running--;
					instance.idle_since = Date.now();



					if (msg.buffers.length) {
						tasks.push(function doBuffers(next) {
							utils.waitForBuffers(msg, next);
						});
					}

					if (msg.streams.length) {
						tasks.push(function doStreams(next) {
							utils.waitForStreams(msg, next);
						});
					}

					utils.parallel(tasks, function done() {

						var obj = {
							string: msg.args || msg.response,
							buffers: msg.readyBuffers,
							streams: msg.readyStreams
						};

						handleCallback(msg.cbid, dry.undry(obj));
					});
					break;

				case 'ping':
					instance.lag = msg.lag;
					break;

				case 'event':
					instance.emit(msg.name, msg.args);
					break;

				default:
					console.log('Unknown instance message:', msg);
			}
		});

		instance.id = id;

		instances.push(instance);
		ordered.push(instance);
		forks++;

		return instance;
	};

	/**
	 * Function userd by Array#sort to sort instances
	 *
	 * @author   Jelle De Loecker   <jellekipdola.be>
	 * @since    0.1.0
	 * @version  0.1.2
	 */
	function sortInstances(a, b) {

		var alag,
		    blag;

		if (!a) {
			return 1;
		}

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
	 * @version  0.1.2
	 */
	forkify.getInstance = function getInstance() {

		var instance,
		    found,
		    i;

		if (forks < 1) {
			instance = forkify.addInstance();
			found = true;
		} else {

			ordered.sort(sortInstances);

			for (i = 0; i < ordered.length; i++) {
				instance = ordered[i];

				if (!instance || !instance.connected) {
					instance = null;
					continue;
				}

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

		if (!found && forks < forkify.limit) {
			return forkify.addInstance();
		}

		// If the last found instance element isn't valid, return the first one
		if (!instance) {
			return ordered[0];
		}

		instance.idle_since = Date.now();

		return instance;
	};

	return forkify;
}

module.exports = ForkifyCreator();