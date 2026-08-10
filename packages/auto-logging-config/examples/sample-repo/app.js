// App de exemplo com chamadas console.* em estilo JS.
function greet(name) {
  console.log("hello, %s!", name);
}

function greetLoud(name) {
  console.log("hello, %s!!", name);
}

module.exports = { greet, greetLoud };
