package handler

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/claudecode/relay-server/auth"
	"github.com/claudecode/relay-server/config"
	"github.com/claudecode/relay-server/db"
	"github.com/claudecode/relay-server/model"
)

type clientSession struct {
	User   *db.User
	Claims *auth.Claims
}

func currentClientSession(r *http.Request, cfg *config.Config, database *db.DB) (*clientSession, error) {
	token, err := readBearerToken(r)
	if err != nil {
		return nil, err
	}

	claims, err := auth.VerifyToken(cfg.JWTSecret, token)
	if err != nil {
		return nil, fmt.Errorf("invalid token")
	}

	var userID int
	switch claims.Type {
	case model.ClientTypeAgent:
		if strings.TrimSpace(claims.AgentID) == "" {
			return nil, fmt.Errorf("agent token is missing agent_id")
		}
		userID, err = database.GetAgentUserID(claims.AgentID)
	case model.ClientTypeDevice:
		if strings.TrimSpace(claims.DeviceID) == "" {
			return nil, fmt.Errorf("device token is missing device_id")
		}
		userID, err = database.GetDeviceUserID(claims.DeviceID)
	default:
		return nil, fmt.Errorf("unsupported client type")
	}
	if err != nil {
		return nil, err
	}

	user, err := database.GetUserByID(userID)
	if err != nil {
		return nil, err
	}

	return &clientSession{
		User:   user,
		Claims: claims,
	}, nil
}
