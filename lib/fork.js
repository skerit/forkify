var EventEmitter = require('events').EventEmitter,
    toobusy = require('toobusy-js'),
    utils = require('./utils'),
    dry = require('./json-dry'),
    functions = [],
    instanceId = Number(process.argv[2]),
    bufferid = 0,
    execs = {};

// Catch all the errors
process.on('uncaughtException', function onErr(err) {
	process.send({type: 'error', stack: err.stack, message: err.message});
});

// Set the buffer function handler
process.waitForBuffers = utils.waitForBuffers;
process.waitForStreams = utils.waitForStreams;

/**
 * Return an object for json-drying this error
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @return   {Object}
 */
Object.defineProperty(Error.prototype, 'toDry', {
	enumerable: false,
	configurable: true,
	writable: false,
	value: function toDry() {
		return {
			value: {
				message: this.message,
				stack: this.stack
			},
			path: 'ForkError'
		};
	}
});

/**
 * Listen to messages coming from the parent instance
 *
 * @author   Jelle De Loecker   <jelle@codedor.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @param   {Object}   packet
 */
process.on('message', function onMessage(packet) {

	var tasks = [],
	    key;

	switch (packet.type) {

		// Received new function to store
		case 'wrap':
			storeWrapper(packet.fnc, packet.id);
			break;

		// Execution of function requested
		case 'exec':
			utils.reviveArguments(packet, function done(err, data) {
				execFunction(data.fncid, data.cbid, data.args);
			});
			break;

		// Event related to specific function execution
		case 'cbevent':
			for (key in execs) {
				if (key == packet.cbid) {
					execs[key]._handleEvent(packet);
				}
			}
			break;

		case 'reapevent':
			delete execs[packet.cbid];
			break;

		// Fork specific event
		case 'event':
			process.emit(packet.name);
			break;

		case 'eventresponse':
			for (key in execs) {
				if (key == packet.cbid) {
					execs[key]._handleResponse(packet);
				}
			}
			break;

		default:
			console.log('Got unknown message from parent:', packet);
	}
});

/**
 * Send a ping to the parent
 *
 * @author   Jelle De Loecker   <jellekipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 */
function sendPing() {
	process.send({type: 'ping', lag: toobusy.lag()});
}

// Send this ping every 2.5 seconds
setInterval(sendPing, 2500).unref();

/**
 * Store the gotten function in this wrapper
 *
 * @author   Jelle De Loecker   <jellekipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 */
function storeWrapper(fncString, id) {

	var fnc;

	// Eval the function string
	eval('fnc = ' + fncString);

	// Store it in the object
	functions[id] = fnc;
};

/**
 * Execute a stored function
 *
 * @author   Jelle De Loecker   <jellekipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 */
function execFunction(fncid, cbid, args) {

	var event = new EventEmitter(),
	    fnc = functions[fncid],
	    cb;

	if (!fnc) {
		return console.error('Could not find function id', fncid);
	}

	sendPing();

	if (cbid != null) {
		cb = function callback() {

			var resargs = [],
			    buffers = [],
			    streams = [],
			    buffer,
			    stream,
			    tasks = [],
			    data,
			    i;

			for (i = 0; i < arguments.length; i++) {
				resargs.push(arguments[i]);
			}

			resargs = dry.dry(resargs);

			// See if there were any buffers inside the arguments
			for (i = 0; i < resargs.buffers.length; i++) {
				buffer = resargs.buffers[i];
				buffer.bufferid = '/tmp/forkify-b-' + Date.now() + '-' + bufferid++;
				buffers.push({bufferid: buffer.bufferid, length: buffer.length});
			}

			// See if there were any buffers inside the arguments
			for (i = 0; i < resargs.streams.length; i++) {
				stream = resargs.streams[i];
				stream.streamid = '/tmp/forkify-s-' + Date.now() + '-' + bufferid++;
				streams.push({streamid: stream.streamid});
			}

			data = {
				type: 'callback',
				cbid: cbid,
				response: resargs.string,
				buffers: buffers,
				streams: streams
			};

			if (!resargs.buffers.length && !resargs.streams.length) {
				return process.send(data);
			}

			if (buffers.length) {
				tasks.push(function doBuffers(next) {
					utils.sendBuffers(resargs.buffers, next);
				});
			}

			if (streams.length) {
				tasks.push(function doStreams(next) {
					utils.sendStreams(resargs.streams, next);
				});
			}

			utils.parallel(tasks, function done() {
				process.send(data);
			});
		};

		args.push(cb);
	}

	// Store the context in the execs objects
	execs[cbid] = event;

	utils.setEventEmitter(process, event, null, cbid);


	// // Store the old emit function
	// ctx._emit = ctx.emit;

	// // Override the emit function
	// ctx.emit = function emitToParent(type) {

	// 	// Emit locally first
	// 	ctx._emit.apply(ctx, arguments);

	// 	// Convert the arguments and send them to the fork
	// 	utils.convertArguments(arguments, function done(err, packet) {

	// 		packet.type = 'cbevent';
	// 		packet.cbid = cbid;

	// 		process.send(packet);
	// 	});
	// };

	try {
		fnc.apply(event, args);
	} catch (err) {
		if (cb) {
			cb(err);
		} else {
			console.error('Uncaught worker error:', err);
		}
	}
};