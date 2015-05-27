var dry = require('./json-dry'),
    toobusy = require('toobusy-js'),
    functions = [],
    instanceId = Number(process.argv[2]);

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
			execFunction(msg.fncid, msg.cbid, dry.undry(msg.args));
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

	var fnc = functions[fncid],
	    cb;

	if (!fnc) {
		return console.error('Could not find function id', fncid);
	}

	sendPing();

	if (cbid != null) {
		cb = function callback() {

			var resargs = [],
			    i;

			for (i = 0; i < arguments.length; i++) {
				resargs.push(arguments[i]);
			}

			process.send({type: 'callback', cbid: cbid, response: dry.dry(resargs)});
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