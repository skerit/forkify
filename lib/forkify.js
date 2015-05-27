var fork = require('child_process').fork,
    dry = require('./json-dry');

function ForkifyCreator() {

	var instances = [],
	    functions = [],
	    callbacks = [],
	    ordered = [];

	// Instances limit, 3 by default
	forkify.limit = 3;

	// Create a link to the constructor
	forkify.constructor = ForkifyCreator;

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

			// Increase the running count
			instance.running++;

			// Send the exec request to the worker
			instance.send({type: 'exec', fncid: id, cbid: cbid, args: args});
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
		    id = instances.length;

		// Create the instance
		instance = fork(__dirname + '/fork.js', [id]);

		// Last time we got a message from the instance
		instance.updated_on = Date.now();

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
					handleCallback(msg.cbid, dry.undry(msg.response));
					break;

				case 'ping':
					instance.lag = msg.lag;
					break;

				default:
					console.log('Unknown instance message:', msg);
			}
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

				// If this instance isn't too busy, see if we can use it
				if (!instance.toobusy()) {

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

		return instance;
	};

	return forkify;
}

module.exports = ForkifyCreator();