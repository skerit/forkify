## 0.1.4 (WIP)

* Add `weak` dependency to prevent memory leaks
* 

## 0.1.3 (2015-06-04)

* Unix sockets are used instead of the extra spawned fd,
  this way buffers can be sent in parallel
* Fix JSON-dry bug where it looped over buffers,
  causing long delays
* Add support for (readable) streams
* Add events, from fork to parent

## 0.1.2 (2015-05-30)

* Fix bug where reaped instance would still be sent messages

## 0.1.1 (2015-05-29)

* Added modified JSON2 implementation, in order to bypass
  the very costly Buffer#toJSON
* Allow passing of Buffer objects, without expensive serializing
* Reap idle instances (after 30 seconds by default)

## 0.1.0 (2015-05-28)

* Initial commit and release
