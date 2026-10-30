const path = require('path');
const express = require('express');
const app = require('./app');

app.use(express.static(path.join(__dirname, '..', 'public')));
const port = process.env.PORT || 3000;
// Node's default accept queue is 511: a burst of new connections beyond that is refused outright.
app.listen({ port, backlog: Number(process.env.LISTEN_BACKLOG) || 4096 }, () => console.log(`http://localhost:${port}`));
