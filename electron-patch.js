// Este archivo se carga via --require ANTES de main.js
// Registra "electron" como módulo en el cache de Node para que
// cuando main.js haga require("electron"), obtenga el valor correcto.

// En este punto, c._load de Electron ya está activo pero aún no procesó
// ningún require. Podemos parchear Module._load para que cuando se pida
// "electron", use c._load directamente sin pasar por _resolveFilename.

const Module = require('module');

const _cLoad = Module._load; // Este es c._load de Electron

// Registrar un getter que captura el resultado de c._load("electron")
// la primera vez que se pide, sin que _resolveFilename interfiera
Module._load = function interceptor(request, parent, isMain) {
  if (request === 'electron') {
    // Temporalmente usar solo builtins de Node (sin node_modules)
    // El truco: si removemos parent de la búsqueda, c._load usará su
    // lista interna de builtins que incluye "electron"
    try {
      return _cLoad.call(this, request, null, false);
    } catch(_) {
      // fallback: el c._load con parent normal
      return _cLoad.call(this, request, parent, isMain);
    }
  }
  return _cLoad.call(this, request, parent, isMain);
};
