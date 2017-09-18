'use strict'

var Discord = require('discord.io');
var logger  = require('winston');
var fetch   = require('isomorphic-unfetch');
var express = require('express');
var app     = express();
var auth    = require('./auth.json');
var config   = require('./data/twitter_config');
var Twitter = require('twitter-node-client').Twitter;
var twitter = new Twitter(config);

/* @TODO: Look into these - not firing */
app.get('/', function (req, res) {
  res.send('Hello World');
});

app.all('/twitter/callback', function (req, res) {
  console.log('req', req, 'res', res);
});

app.listen(8080);
console.log('listening on 8080');

// Callback functions
/* @TODO: Move into utility file */
function error (err, response, body) {
  console.log('ERROR [%s]', err);
};
function success (data) {
  console.log('Data [%s]', data);
};
function postAsPromised (data) {
  return new Promise(function (resolve, reject) {
    twitter.postMedia({
      media_data: data
    }, reject, resolve)
  });
}

// Configure logger settings
logger.remove(logger.transports.Console);
logger.add(logger.transports.Console, {
  colorize: true
});
logger.level = 'debug';

/* Bot not active until set */
var active = false;

// Initialize Discord Bot
var bot = new Discord.Client({
  token: auth.token,
  autorun: true
});

bot.on('ready', function (evt) {
  logger.info('Connected');
  logger.info('Logged in as: ');
  logger.info(bot.username + ' - (' + bot.id + ')');
});

bot.on('message', function (user, userID, channelID, message, evt) {
  /* On every message, if bot is active, post message to Twitter */
  if (active && message.substring(0,1) !== '!') {

    /* If there are attachments, upload first and then upload tweet */
    if (evt.d && evt.d.attachments) {
      /* Not sure you can actually upload more than one thing at a time.... */
      Promise.all(evt.d.attachments.map(item => {
        // do stuff
        return fetch(item.url)
          .then(res => res.buffer())
          .then(buffer => buffer.toString('base64'))
          .then(data => postAsPromised(data))
          .then(data => JSON.parse(data).media_id_string)
          .catch(console.log); /* @TODO: Better error handling, possibly don't even tweet without image? */
      }))
        .then(array => {
          const string = array.join(',');
          twitter.postTweet({
            status: message,
            media_ids: string
          }, error, success)
        })
    } else {
      /* No attachments, do a straight tweet */
      twitter.postTweet({
        status: message
      }, error, success);
    }
  }

  // Our bot needs to know if it will execute a command
  // It will listen for messages that will start with `!`
  if (message.substring(0, 1) == '!') {
    var args = message.substring(1).split(' ');
    var cmd = args[0];
    
    args = args.splice(1);
    switch(cmd) {
      case 'activate':
        active = true;
        break;
      case 'deactivate':
        active = false;
        break;
      case 'ping':
        if (active) {
          bot.sendMessage({
            to: channelID,
            message: 'Pong!'
          });
        }
      default:
      break;
    }
  }
});

bot.on('any', function (event) {
  // console.log('event', event);
  const type = event.t;
  const data = event.d;
  /* @TODO: Look into reaction-based messaging */
});

bot.on('disconnect', function (errMsg, code) {
  logger.error('DISCONNECTED', errMsg);
  logger.error('CODE: ', code);

  bot.connect();
});