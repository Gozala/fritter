/* globals app */

const yo = require('yo-yo')
const renderProfileCard = require('../com/profile-card')
const renderBackToFeed = require('../com/back-to-feed')
const renderProfileListingItem = require('../com/profile-listing-item')

// exported api
// =

module.exports = function renderFriends () {
  return yo`
    <div class="view friends">
      <div class="sidebar-col">
        ${renderBackToFeed()}
        ${renderProfileCard(app.viewedProfile)}
      </div>

      <div class="main-col">
        <div class="view-content">
          <h2>Followers you know:</h2>

          ${!app.viewedProfile.friends
            ? ''
            : yo`
              <div class="following-list">
                ${app.viewedProfile.friends.map(renderProfileListingItem)}
              </div>
            `
          }
        </div>
      </div>
    </div>
  `
}
