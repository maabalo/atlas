// Atlas test fixture: each function is used in a different way (see tests/test_atlas.py).
'use strict';

const byId = (id) => document.getElementById(id);

function greet(name) {
  return `Hello, ${shout(name)}!`; // a call inside a template literal
}

function shout(text) {
  return text.toUpperCase();
}

function parts() {
  return ['a', 'b'];
}

function neverCalled() {
  // a string that looks like code must not count as a call: "parts()"
  return 'unused';
}

const onGo = function () {
  const out = byId('output');
  out.textContent = greet(byId('nameInput').value);
  out.classList.toggle('is-active', true);
  out.className = `theme--${'dark'}`;
  out.after(liveNote());
  return [...parts()];
};

function liveNote() {
  const note = document.createElement('p');
  note.id = 'liveNote'; // an id created by script: declared, so "#liveNote" below isn't missing
  note.dataset.id = 'notAnId'; // a data-id attribute: must NOT count as an element id
  return note;
}

byId('liveNote');

document.querySelector('#goBtn').addEventListener('click', onGo);
