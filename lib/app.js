/* globals window */

const yo = require('yo-yo')
const nanorouter = require('nanorouter')
const LibFritter = require('@beaker/libfritter')
const views = require('../views/index')
const {pluralize, toCSSColor, polyfillHistoryEvents} = require('./util')

const themeColor = {h: 4, s: 100, l: 65, a: 1}
const themeColors = {
  base: themeColor,
  border: Object.assign({}, themeColor, {l: 83}),
  boxShadow: Object.assign({}, themeColor, {l: 87}),
  faded: Object.assign({}, themeColor, {l: 95})
}

module.exports = class FritterApp {
  constructor () {
    this.libfritter = new LibFritter('fritter')
    this.currentUser = null
    this.currentUserProfile = null
    this.currentView = 'home'
    this.currentSubview = null

    this.posts = []
    this.viewedProfile = null
    this.viewedPost = null
    
    this.postDraftText = ''
    this.replyDraftText = ''
    this.isEditingPost = false
    this.isEditingReply = false
    this.tmpAvatar = null
  }

  getThemeColor (k) {
    return toCSSColor(themeColors[k])
  }

  async setup () {
    // setup router
    this.router = nanorouter()
    this.router.on('/', () => this.setView('feed'))
    this.router.on('/thread/*', p => this.setView('thread', p.wildcard))
    this.router.on('/user/*', p => this.setView('user', p.wildcard))
    this.router.on('/edit', p => this.setView('edit'))
    const onRouteChange = () => this.router(window.location.pathname)
    polyfillHistoryEvents()
    window.addEventListener('pushstate', onRouteChange)
    window.addEventListener('popstate', onRouteChange)

    // load global data
    await this.libfritter.open()
    await this.setCurrentUser(window.localStorage.userUrl)
    onRouteChange()

    // index everybody the user follows
    if (this.currentUserProfile) {
      await Promise.all(this.currentUserProfile.followUrls.map(async (url) => {
        await this.libfritter.addSource(url)
        onRouteChange() // reload feed and render (TODO replace with something better)
      }))
    }

    // fetch new posts every second
    window.setInterval(this.checkForNewPosts.bind(this), 1000)
  }

  async setCurrentUser (url) {
    if (!url) return
    this.currentUser = new DatArchive(url)
    await this.libfritter.prepareArchive(this.currentUser)
    await this.libfritter.addSource(this.currentUser)
    await this.loadCurrentUserProfile()
  }

  async loadCurrentUserProfile () {
    this.currentUserProfile = await this.libfritter.social.getProfile(this.currentUser)
    this.currentUserProfile.isCurrentUser = true    
  }

  async setView (view, param) {
    console.log('setView', ...arguments)
    this.currentView = view
    this.currentSubview = null
    this.viewedProfile = null
    this.viewedPost = null

    if (view === 'feed') {
      await this.loadFeedPosts()
    }
    if (view === 'user') {
      if (!this.libfritter.isSource(param)) {
        await this.libfritter.addSource(param)
      }
      this.viewedProfile = await this.libfritter.social.getProfile(param)
      await this.loadFeedPosts()
    }
    if (view === 'thread') {
      await this.loadViewedPost(param)
      console.log('loaded post', this.viewedPost)
    }

    this.render()
    window.scrollTo(0, 0)
  }

  setSubview (subview) {
    this.currentSubview = subview
    this.render()
  }

  render () {
    views.render()
  }

  // loaders
  // =

  async loadFeedPosts () {
    var query = {
      fetchAuthor: true,
      countVotes: true,
      reverse: true,
      rootPostsOnly: true,
      countReplies: true
    }
    if (this.viewedProfile) {
      query.rootPostsOnly = false
      query.author = this.viewedProfile.getRecordOrigin()
    } else {
      query.authors = this.getAuthorWhitelist()
    }
    this.posts = await this.libfritter.feed.listPosts(query)
    this.posts = await Promise.all(this.posts.map(async p => {
      if (p.threadParent) {
        p.threadParent = await this.libfritter.feed.getThread(p.threadParent)
      }
      return p
    }))
  }

  async loadViewedPost (href) {
    try {
      this.viewedPost = await this.libfritter.feed.getThread(href)
      if (this.viewedPost) {
        this.viewedPost.author.isCurrentUser = this.viewedPost.author.getRecordOrigin() === this.currentUserProfile.getRecordOrigin()
      }
    } catch (e) {
      console.error(e)
    }
  }

  async checkForNewPosts () {
    const indicatorEl = document.querySelector('.new-posts-indicator')
    if (!indicatorEl) return

    var query = {
      limit: 1,
      reverse: true,
      rootPostsOnly: true
    }

    if (this.viewedProfile) {
      query.rootPostsOnly = false
      query.author = this.viewedProfile.getRecordOrigin()
    }

    let newestPost = await this.libfritter.feed.listPosts(query)
    newestPost = newestPost[0]

    if (newestPost && this.posts[0] && newestPost.getRecordURL() !== this.posts[0].getRecordURL()) {
      const reloadFeed = async () => {
        await this.loadFeedPosts()
        this.render()
      }
      yo.update(
        indicatorEl,
        yo`<div class="new-posts-indicator" onclick=${reloadFeed}>new posts</div>`
      )
    }
  }

  async loadViewedProfile () {
    try {
      // load the profile
      var selectedProfileKey = null // TODO
      if (selectedProfileKey) {
        this.viewedProfile = await this.libfritter.social.getProfile(`dat://${selectedProfileKey}`)
        this.viewedProfile.isCurrentUserFollowing = await this.libfritter.social.isFollowing(this.currentUserProfile.getRecordOrigin(), this.viewedProfile.getRecordOrigin())

        const friends = await this.libfritter.social.listFriends(this.viewedProfile.getRecordOrigin())
        this.viewedProfile.friends = friends.filter(f => f.getRecordOrigin() !== this.currentUserProfile.getRecordOrigin())
      }
      this.render()

      // load extra data and render again
      await Promise.all(this.viewedProfile.follows.map(async (f) => {
        f.isCurrentUser = f.url === this.currentUserProfile.getRecordOrigin()
        const fullProfile = await this.libfritter.social.getProfile(f.url)
        return Object.assign(f, fullProfile)
      }))
      this.render()
    } catch (e) {
      // TODO
      console.error(e)
    }
  }

  // mutators
  // =

  async updateProfile ({name, bio} = {}) {
    // create user if needed
    if (!this.currentUser) {
      this.currentUser = await DatArchive.create({
        title: 'Fritter User: ' + name,
        description: 'User profile for the Fritter example app'
      })
      await this.libfritter.prepareArchive(this.currentUser)
      await this.libfritter.addSource(this.currentUser)
      window.localStorage.userUrl = this.currentUser.url
    }

    // update profile
    await this.libfritter.social.setProfile(this.currentUser, {name, bio})

    // if the avatar's changed, update the profile avatar
    if (this.tmpAvatar) {
      await this.libfritter.social.setAvatar(this.currentUser, this.tmpAvatar.imgData, this.tmpAvatar.imgExtension)
    }
    this.tmpAvatar = undefined

    // reload user data
    await this.loadCurrentUserProfile()
  }

  async toggleFollowing (user) {
    var userUrl = user.getRecordOrigin ? user.getRecordOrigin() : user.url // we may be given a profile record or a follows record
    if (this.isCurrentUserFollowing(user)) {
      await this.libfritter.social.unfollow(this.currentUser, userUrl)
    } else {
      await this.libfritter.social.follow(this.currentUser, userUrl, user.name || '')
    }
    await this.loadCurrentUserProfile()
    this.render()
  }

  async toggleLiked (p) {
    const vote = p.votes.upVoters.includes(this.currentUser.url) ? 0 : 1
    await this.libfritter.feed.vote(this.currentUser, {vote, subject: p.getRecordURL()})
    p.votes = await this.libfritter.feed.countVotesFor(p.getRecordURL())
    this.render()
  }

  // helpers
  // =

  isCurrentUserFollowing (url) {
    if (!this.currentUserProfile) return false
    if (typeof url !== 'string') {
      url = url.getRecordOrigin ? url.getRecordOrigin() : url.url
    }
    return this.currentUserProfile.followUrls.includes(url)
  }

  getAuthorWhitelist () {
    if (!this.currentUserProfile) return []
    return this.currentUserProfile.followUrls.concat(this.currentUser.url)
  }

  gotoFeed (e) {
    if (e) {
      e.stopPropagation()
      e.preventDefault()
    }
    window.history.pushState({}, null, '/')
  }

  gotoEditProfile (e) {
    if (e) {
      e.stopPropagation()
      e.preventDefault()
    }
    window.history.pushState({}, null, '/edit')
  }

  threadUrl (post) {
    return '/thread/' + post.getRecordURL()
  }

  gotoThread (post, e) {
    if (e) {
      e.stopPropagation()
      e.preventDefault()
    }
    window.history.pushState({}, null, this.threadUrl(post))
  }

  profileUrl (profile) {
    const url = profile.getRecordOrigin ? profile.getRecordOrigin() : profile.url
    return '/user/' + url
  }

  gotoProfile (profile, e) {
    if (e) {
      e.stopPropagation()
      e.preventDefault()
    }
    window.history.pushState({}, null, this.profileUrl(profile))
  }
}
