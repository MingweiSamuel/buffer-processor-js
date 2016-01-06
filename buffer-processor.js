#!/usr/bin/env node
"use strict";

var BufferOffset = require('buffer-offset')

var TypeReader = (function() {
  var tr = function() {};
  tr.prototype._addCustomTypes = function(customTypes) {
    this.customTypes = customTypes;
  };
  
  //

  tr.prototype.uint = function(bits) {
    var f = BufferOffset.prototype['getUInt' + bits + 'BE'];
    if (!f)
      throw new Error('Invalid bit count');

    return function(buf) {
      return f.call(buf);
    };
  };
  tr.prototype.int = function(bits) {
    var f = BufferOffset.prototype['getInt' + bits + 'BE'];
    if (!f)
      throw new Error('Invalid bit count');

    return function(buf) {
      return f.call(buf);
    };
  };
  tr.prototype.xdrOpaque = function(max) {
    max = max || 0xFFFFFFFF;

    return function(buf) {
      var len = buf.getUInt32BE(); // in bytes
      if (len > max)
        throw new Error('xdrOpaque exceeds max length');
      var newBuf = new Buffer(len);
      buf.copy(newBuf, 0, buf._offset, buf._offset += len);
      return newBuf;
    };
  };
  tr.prototype.xdrString = function(max) {
    max = max || 0xFFFFFFFF;

    return function(buf) {
      var len = buf.getUInt32BE(); // in bytes
      if (len > max)
        throw new Error('xdrString exceeds max length');
      return buf.toString('ascii', buf._offset, buf._offset += len);
    };
  };
  tr.prototype.xdrArray = function(type, max) {
    if (typeof type !== 'function')
      throw new Error('Invalid type: ' + type);
    max = max || 0xFFFFFFFF;

    return function(buf) {
      var len = buf.getUInt32BE();
      if (len > max)
        throw new Error('xdrArray exceeds max length');
      var out = [];
      for (var i = 0; i < len; i++)
        out.push(type(buf));
      return out;
    };
  };
  tr.prototype.ref = function(type) {
    return function(buf) {
      var f = this.customTypes[type];
      if (!f)
        throw new Error('invalid type');
      return f(buf);
    }.bind(this);
  };
  return tr;
})();

var TypeDictionary = (function() {
  var td = function() {};
  return td;
})();

var ModelBuilder = (function() {
  var mb = function() {
    this.fields = [];
    this.types = [];

    console.log('ModelBuilder: created');
  };
  mb.prototype.add = function(field, type) {
    if (typeof field !== 'string')
      throw new Error('first arg must be string');
    if (typeof type !== 'function')
      throw new Error('second arg must be valid type');

    this.fields.push(field);
    this.types.push(type);

    console.log('ModelBuilder: adding field %s', field);
  };
  mb.prototype.build = function() {
    console.log('ModelBuilder: building');

    var fields = this.fields;
    var types = this.types;
    return function(buf) {
      var obj = {};
      for (var i = 0; i < fields.length; i++)
        obj[fields[i]] = types[i](buf);
      return obj;
    };
  };
  return mb;
})();

var ProcessorBuilder = (function() {
  var pb = function() {
    this.customTypes = {};
    this.built = false;

    console.log('ProcessBuilder: created');
  };
  pb.prototype.config = function(type, def) {
    if (typeof type !== 'string')
      throw new Error('first arg must be string');
    if (typeof def !== 'function')
      throw new Error('second arg must be function');
    if (this.built)
      throw new Error('Processor has already been compiled');

    console.log('ProcessBuilder: adding %s', type);

    this.customTypes[type] = def;
  };
  pb.prototype.build = function() {
    console.log('ProcessBuilder: building');

    this.built = true;
    
    var typeReader = new TypeReader();

    var types = Object.keys(this.customTypes);
    for (var i = 0; i < types.length; i++) {
      var type = types[i];
      var def = this.customTypes[type];

      var modelBuilder = new ModelBuilder();
      def(modelBuilder.add.bind(modelBuilder), typeReader);
      this.customTypes[type] = modelBuilder.build();
    }
    typeReader._addCustomTypes(this.customTypes);

    return new Processor(typeReader);
  };
  return pb;
})();

var Processor = (function() {
  var p = function(typeReader) {
    this.typeReader = typeReader;
  };
  p.prototype.process = function(type, buf) {
    buf = BufferOffset.convert(buf);
    var typeFunc = this.typeReader.ref(type);
    if (!typeFunc)
      throw new Error('Invalid type');
    return typeFunc(buf);
  };
  return p;
})();


var bufferProcessor = module.exports = function(configFunction) {
  if (typeof configFunction !== 'function')
    throw new Error('Argument must be function');

  var processorBuilder = new ProcessorBuilder();
  
  console.log('Running configFunction');
  configFunction(processorBuilder.config.bind(processorBuilder));

  return processorBuilder.build();
}

//////////

var util = require('util');

var processor = bufferProcessor(function(config) {
  config('Announcement', function(model, type) {
    model('magic', type.uint(32));//.validate(0x9D79BC40));
    model('thisDevice', type.ref('Device'));
    model('extraDevices', type.xdrArray(type.ref('Device'), 32));
  });

  config('Device', function(model, type) {
    model('id', type.xdrOpaque(32));
    model('addresses', type.xdrArray(type.ref('Address'), 16));
    model('relays', type.xdrArray(type.ref('Relay'), 16));
  });

  config('Address', function(model, type) {
    model('url', type.xdrString(2083));
  });

  config('Relay', function(model, type) {
    //model.Address();
    model('latency', type.int(32));
  });
});


var buf = new Buffer([157,121,188,64,0,0,0,32,63,164,243,255,165,186,225,83,93,170,174,
110,101,210,160,188,220,186,66,122,17,44,230,35,218,110,168,213,110,231,143,165,0,0,0,
1,0,0,0,19,116,99,112,58,47,47,48,46,48,46,48,46,48,58,50,50,48,48,48,0,0,0,0,0,0,0,0,0]);

var x = processor.process('Announcement', buf);
console.log(JSON.stringify(x));

/*

struct Announcement {
    unsigned int Magic;
    Device This;
    Device Extra<>;
}

struct Device {
    opaque ID<32>;
    Address Addresses<16>;
    Relay Relays<16>;
}

struct Address {
    string URL<2083>;
}

struct Relay {
    string URL<2083>;
    int Latency;
}

//*/
