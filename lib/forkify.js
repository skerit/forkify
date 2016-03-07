var EventEmitter = require('events').EventEmitter,
    utils = require('./utils'),
    fork = require('child_process').fork,
    weak = require('weak'),
    dry = require('./json-dry'),
    net = require('net');

/**
 * Forkify pool creator
 *
 * @author   Jelle De Loecker   <jellekipdola.be>
 * @since    0.1.0
 * @version  0.1.4
 */
function ForkifyCreator() {

	var instances = [],
	    functions = [],
	    callbacks = [],
	    ordered = [],
	    bufferid = 0,
	    execs = {},
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
	 * When an event listener is GC'd, tell the instance to remove it too
	 *
	 * @author   Jelle De Loecker   <jellekipdola.be>
	 * @since    0.1.4
	 * @version  0.1.4
	 */
	function reapEvent(instance, cbid) {
		delete execs[cbid];
		instance.send({type: 'reapevent', cbid: cbid});
	}

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
			    _emit,
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
			} else {
				cb = null;
			}

			// Get the callback id, even if there is none
			cbid = callbacks.push(cb) - 1;

			// instance.on('fnc-exec-event-' + cbid, function gotEvent(packet) {
			// 	console.log('Got event', packet)
			// 	event.emit.apply(event, [packet.type].concat(packet.args));
			// });

			// Create the args array
			args = new Array(len);

			// Turn the arguments object into an array
			for (i = 0; i < len; i++) {
				args[i] = arguments[i];
			}

			// Convert the arguments and send them to the fork
			utils.convertArguments(args, function done(err, packet) {

				packet.type = 'exec';
				packet.fncid = id;
				packet.cbid = cbid;

				instance.send(packet);
			});

			execs[cbid] = weak(event, reapEvent.bind(null, instance, cbid));
			utils.setEventEmitter(instance, event, id, cbid);

			return event;

			event._emit = event.emit;

			// Overide the emit function to send the event to the fork
			event.emit = function emit(type) {
				// Emit locally first
				event._emit.apply(event, arguments);

				// Convert the arguments and send them to the fork
				utils.convertArguments(arguments, function done(err, packet) {

					packet.type = 'cbevent';
					packet.fncid = id;
					packet.cbid = cbid;

					instance.send(packet);
				});
			};

			event.cbid = cbid;

			

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

		if (!cb) {
			throw new Error('Got callback response, but no callback was set');
		}

		cb.apply(null, response);
	}

	/**
	 * Create a new instance
	 *
	 * @author   Jelle De Loecker   <jellekipdola.be>
	 * @since    0.1.0
	 * @version  0.1.4
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
		instance.on('message', function onForkMessage(packet) {

			var tasks = [],
			    temp,
			    key;

			instance.updated_on = Date.now();

			if (packet.type != 'ping') {
				instance.idle_since = Date.now();
			}

			switch (packet.type) {

				case 'callback':
					instance.running--;

					utils.reviveArguments(packet, function done(err, data) {
						handleCallback(data.cbid, data.args);
					});
					break;

				case 'ping':
					instance.lag = packet.lag;
					break;

				case 'cbevent':
					for (key in execs) {
						if (key == packet.cbid) {
							execs[key]._handleEvent(packet);
						}
					}
					break;

				case 'eventresponse':
					for (key in execs) {
						if (key == packet.cbid) {
							execs[key]._handleResponse(packet);
						}
					}
					break;

				case 'event':
					instance.emit(packet.name, packet.args);
					break;

				case 'error':
					temp = new Error();
					temp.message = packet.message;
					temp.stack = packet.stack;
					instance.emit('error', temp);

				default:
					console.log('Unknown instance message:', packet);
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