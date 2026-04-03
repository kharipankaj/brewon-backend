let adminNamespace = null;

function setAdminNamespace(namespace) {
  adminNamespace = namespace;
}

function emitAdminEvent(event, payload) {
  if (!adminNamespace) {
    return;
  }

  adminNamespace.emit(event, payload);
}

module.exports = {
  setAdminNamespace,
  emitAdminEvent,
};
