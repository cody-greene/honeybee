Zero dependency http(s) library for node & modern browsers with:
- automatic retry on status code 429 using the Retry-After header, or falling back to exponential backoff
- uses native promises internally
- JSON by default

#### Examples
```javascript
import request from 'honeybee'

// Get a Google OAuth2 access token
const res = await request({
  method: 'POST',
  url: 'https://www.googleapis.com/oauth2/v3/token',
  contentType: 'form',
  body: {
    refresh_token: '<user_refresh_token>',
    client_id: '<GOOG_OAUTH_CLIENT_ID>',
    client_secret: '<GOOG_OAUTH_CLIENT_SECRET>',
    grant_type: 'refresh_token'
  }
})
console.log('Authorization: Bearer ' + res.body.access_token)
```
