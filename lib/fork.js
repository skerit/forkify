var toobusy = require('toobusy-js'),
    utils = require('./utils'),
    dry = require('./json-dry'),
    fs = require('fs'),
    functions = [],
    instanceId = Number(process.argv[2]),
    readable = fs.createReadStream(null, {fd: 3}),
    writable = fs.createWriteStream(null, {fd: 3}),
    bufferid = 0;

// Set the aggregator to null
process.aggregator = null;

// Set the array for functions waiting on buffers
process.waiters = [];

// Set the bufferlock to false
process.bufferlock = false;

// Set the buffer function handler
process.waitForBuffers = utils.waitForBuffers;

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
	configurable: false,
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
 * @param   {Object}   msg
 */
process.on('message', function onMessage(msg) {

	switch (msg.type) {

		case 'wrap':
			storeWrapper(msg.fnc, msg.id);
			break;

		case 'exec':

			if (msg.buffers.length) {
				process.waitForBuffers(msg, function gotResponse(err, response) {
					execFunction(msg.fncid, msg.cbid, response);
				});
			} else {
				execFunction(msg.fncid, msg.cbid, dry.undry(msg.args));
			}
			break;

		case 'event':
			process.emit(msg.name);
			break;

		default:
			console.log('Got unknown message from parent:', msg);
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
	process.send({type: 'ping', lag: toobusy.lag(), bufferlock: process.bufferlock});
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
 * If we can receive buffers, set the next listener
 *
 * @author   Jelle De Loecker   <jellekipdola.be>
 * @since    0.1.1
 * @version  0.1.1
 */
process.on('can-receive-buffers', function onCanReceiveBuffers() {
	var fnc = process.waiters.shift();
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
readable.on('data', function gotData(chunk) {
	if (process.aggregator) process.aggregator(chunk);
});

/**
 * Execute a stored function
 *
 * @author   Jelle De Loecker   <jellekipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 */
function execFunction(fncid, cbid, args) {

	var fnc = functions[fncid],
	    cb;

	if (!fnc) {
		return console.error('Could not find function id', fncid);
	}

	sendPing();

	if (cbid != null) {
		cb = function callback() {

			var resargs = [],
			    buffers = [],
			    data,
			    i;

			for (i = 0; i < arguments.length; i++) {
				resargs.push(arguments[i]);
			}

			resargs = dry.dry(resargs);

			// See if there were any buffers inside the arguments
			for (i = 0; i < resargs.buffers.length; i++) {
				buffer = resargs.buffers[i];
				buffer.bufferid = bufferid++;
				buffers.push({bufferid: buffer.bufferid, length: buffer.length});
			}

			data = {
				type: 'callback',
				cbid: cbid,
				response: resargs.string,
				buffers: buffers
			};

			process.send(data);

			// Send the buffers once the parent is ready
			resargs.buffers.forEach(function eachBuffer(buffer, index) {
				process.once('ready-for-buffer-' + buffer.bufferid, function sendBuffer() {
					writable.write(buffer);
				});
			});
		};

		args.push(cb);
	}

	try {
		fnc.apply(null, args);
	} catch (err) {
		if (cb) {
			cb(err);
		} else {
			console.error('Uncaught worker error:', err);
		}
	}
};