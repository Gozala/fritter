/* globals app */

const yo = require('yo-yo')
const renderProfileEditor = require('../com/profile-editor')

// exported api
// =

module.exports = function () {
  return yo`
    <div class="view feed">
      <div class="sidebar-col">
      </div>

      <div class="main-col">
        <h1>Welcome to Fritter!</h1>
        <p>Fritter is an example Twitter-clone. It demonstrates how to build applications on the <a href="https://beakerbrowser.com">Beaker Browser</a>
        using <a href="https://datproject.org">Dat</a> and <a href="https://github.com/beakerbrowser/webdb">WebDB</a>.</p>
        <p>Create your profile to get started:</p>
        ${renderProfileEditor()}
      </div>
    </div>
  `
}

