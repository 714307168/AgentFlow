package auth

import (
	"errors"
	"time"

	"github.com/claudecode/relay-server/model"
	"github.com/golang-jwt/jwt/v5"
)

// Claims extends standard JWT claims with relay-server specific fields.
type Claims struct {
	jwt.RegisteredClaims
	Type     model.ClientType `json:"type"`
	AgentID  string           `json:"agent_id,omitempty"`
	DeviceID string           `json:"device_id,omitempty"`
}

// SignToken creates a signed HS256 JWT for the given identity.
func SignToken(secret, agentID, deviceID string, clientType model.ClientType, ttl time.Duration) (string, error) {
	now := time.Now()
	sub := agentID
	if clientType == model.ClientTypeDevice {
		sub = deviceID
	}

	claims := Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   sub,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
		},
		Type:     clientType,
		AgentID:  agentID,
		DeviceID: deviceID,
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// GenerateToken is an alias for SignToken with simplified parameters
func GenerateToken(secret string, clientType model.ClientType, clientID, sub string, ttl time.Duration) (string, error) {
	agentID := ""
	deviceID := ""
	if clientType == model.ClientTypeAgent {
		agentID = clientID
	} else {
		deviceID = clientID
	}
	return SignToken(secret, agentID, deviceID, clientType, ttl)
}

// VerifyToken parses and validates a JWT, returning the embedded claims.
func VerifyToken(secret, tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return []byte(secret), nil
	})
	if err != nil {
		return nil, err
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, errors.New("invalid token claims")
	}
	return claims, nil
}
