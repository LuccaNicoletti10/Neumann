/** Domain-neutral builtin artifacts. Compiled/validated at publish. */

export const SCORE_RECORD_SOURCE = `function(input, host) {
  var objects = input.objects || [];
  var scores = [];
  for (var i = 0; i < objects.length; i++) {
    var o = objects[i];
    var values = [];
    for (var k in o.properties) values.push(o.properties[k]);
    var filled = 0;
    var nums = [];
    for (var j = 0; j < values.length; j++) {
      var v = values[j];
      if (v != null && v !== '') filled += 1;
      if (typeof v === 'number' && isFinite(v)) nums.push(v);
    }
    var completeness = values.length === 0 ? 0 : filled / values.length;
    var magnitude = 0;
    if (nums.length > 0) {
      var sum = 0;
      for (var n = 0; n < nums.length; n++) sum += nums[n];
      magnitude = sum / nums.length;
    }
    var tanh = (Math.exp(Math.abs(magnitude) / 50) - Math.exp(-Math.abs(magnitude) / 50)) /
      (Math.exp(Math.abs(magnitude) / 50) + Math.exp(-Math.abs(magnitude) / 50));
    if (!isFinite(tanh)) tanh = 1;
    var score = Math.round((0.7 * completeness + 0.3 * tanh) * 10000) / 10000;
    scores.push({
      objectTypeId: o.objectTypeId,
      primaryKey: o.primaryKey,
      score: score,
      features: {
        completeness: Math.round(completeness * 10000) / 10000,
        magnitude: Math.round(magnitude * 10000) / 10000
      }
    });
  }
  return { scores: scores };
}`;

export const AGGREGATE_METRICS_SOURCE = `function(input, host) {
  var objects = input.objects || [];
  var property = String((input.params && input.params.property) || 'value');
  var nums = [];
  for (var i = 0; i < objects.length; i++) {
    var v = objects[i].properties[property];
    if (typeof v === 'number' && isFinite(v)) nums.push(v);
  }
  var numericCount = nums.length;
  var sum = 0;
  var min = 0;
  var max = 0;
  for (var n = 0; n < nums.length; n++) {
    sum += nums[n];
    if (n === 0 || nums[n] < min) min = nums[n];
    if (n === 0 || nums[n] > max) max = nums[n];
  }
  var avg = numericCount === 0 ? 0 : sum / numericCount;
  return {
    property: property,
    count: objects.length,
    numericCount: numericCount,
    sum: Math.round(sum * 10000) / 10000,
    avg: Math.round(avg * 10000) / 10000,
    min: min,
    max: max
  };
}`;

export const DERIVE_FLAGS_SOURCE = `function(input, host) {
  var objects = input.objects || [];
  var threshold = Number((input.params && input.params.threshold) || 0);
  var flags = [];
  for (var i = 0; i < objects.length; i++) {
    var o = objects[i];
    var values = [];
    var nums = [];
    for (var k in o.properties) {
      var v = o.properties[k];
      values.push(v);
      if (typeof v === 'number' && isFinite(v)) nums.push(v);
    }
    var empty = values.length === 0;
    if (!empty) {
      empty = true;
      for (var j = 0; j < values.length; j++) {
        if (values[j] != null && values[j] !== '') { empty = false; break; }
      }
    }
    var above = false;
    for (var n = 0; n < nums.length; n++) {
      if (nums[n] > threshold) { above = true; break; }
    }
    flags.push({
      objectTypeId: o.objectTypeId,
      primaryKey: o.primaryKey,
      empty: empty,
      hasNumeric: nums.length > 0,
      aboveThreshold: above
    });
  }
  return { flags: flags };
}`;
