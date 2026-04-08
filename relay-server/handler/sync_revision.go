package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"

	"github.com/claudecode/relay-server/model"
)

func buildSyncRevision(agentID string, projects []model.ProjectListItem) string {
	if len(projects) == 0 {
		return fmt.Sprintf("sync-empty:%s", strings.TrimSpace(agentID))
	}

	sorted := append([]model.ProjectListItem(nil), projects...)
	sort.Slice(sorted, func(i, j int) bool {
		left := sorted[i]
		right := sorted[j]
		switch {
		case left.AgentID != right.AgentID:
			return left.AgentID < right.AgentID
		case left.ID != right.ID:
			return left.ID < right.ID
		case left.Name != right.Name:
			return left.Name < right.Name
		default:
			return left.Path < right.Path
		}
	})

	hash := sha256.New()
	_, _ = hash.Write([]byte(strings.TrimSpace(agentID)))
	for _, item := range sorted {
		_, _ = hash.Write([]byte{'\n'})
		_, _ = hash.Write([]byte(strings.TrimSpace(item.AgentID)))
		_, _ = hash.Write([]byte{'\n'})
		_, _ = hash.Write([]byte(strings.TrimSpace(item.ID)))
		_, _ = hash.Write([]byte{'\n'})
		_, _ = hash.Write([]byte(strings.TrimSpace(item.Name)))
		_, _ = hash.Write([]byte{'\n'})
		_, _ = hash.Write([]byte(strings.TrimSpace(item.Path)))
		_, _ = hash.Write([]byte{'\n'})
		_, _ = hash.Write([]byte(strings.TrimSpace(item.GroupName)))
		_, _ = hash.Write([]byte{'\n'})
		_, _ = hash.Write([]byte(strings.TrimSpace(item.CLIProvider)))
		_, _ = hash.Write([]byte{'\n'})
		_, _ = hash.Write([]byte(strings.TrimSpace(item.CLIModel)))
		if item.Online {
			_, _ = hash.Write([]byte("\n1"))
		} else {
			_, _ = hash.Write([]byte("\n0"))
		}
	}

	return hex.EncodeToString(hash.Sum(nil))
}
