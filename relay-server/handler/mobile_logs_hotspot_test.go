package handler

import "testing"

func TestBuildConnectionHotspotsUsesGroupedReplayContext(t *testing.T) {
	items := buildConnectionHotspots(map[string]*connectionHotspotAccumulator{
		"desktop-connected": {
			AgentState:      "connected",
			ControllerState: "connected",
			Host:            "desktop-host",
			Platform:        "linux",
			LogCount:        3,
			LogsWithSignals: 3,
			CriticalCount:   1,
			WarningCount:    1,
			SignalTotals: map[string]int{
				"desktop_resume_catchup_stalled":   2,
				"desktop_restart_recovery_residue": 1,
			},
			SignalTitles: map[string]string{
				"desktop_resume_catchup_stalled":   "Desktop resume catch-up stalled",
				"desktop_restart_recovery_residue": "Desktop restart recovery residue",
			},
			RecoveryPanels: map[string]*connectionHotspotRecoveryPanelAccumulator{
				"desktop_active_snapshot|warning|desktop_remote_snapshot_gaps": {
					Key:        "desktop_active_snapshot",
					Title:      "3. Active Snapshot",
					Status:     "warning",
					SignalCode: "desktop_remote_snapshot_gaps",
					LogCount:   2,
				},
			},
			TraceTotals: map[string]int{
				"trace-grouped": 2,
				"trace-top":     3,
			},
			WorkgroupTotals: map[string]int{
				"wg-grouped": 2,
				"wg-top":     3,
			},
			TaskTotals: map[string]int{
				"task-grouped": 2,
				"task-top":     3,
			},
			DispatchTotals: map[string]int{
				"dispatch-grouped": 2,
				"dispatch-top":     3,
			},
			ContextGroups: map[string]*connectionHotspotContextAccumulator{
				buildConnectionHotspotContextKey("desktop_resume_catchup_stalled", "trace-grouped", "wg-grouped", "task-grouped", "dispatch-grouped"): {
					SignalCode:    "desktop_resume_catchup_stalled",
					TraceID:       "trace-grouped",
					WorkgroupID:   "wg-grouped",
					TaskID:        "task-grouped",
					DispatchRunID: "dispatch-grouped",
					LogCount:      2,
				},
				buildConnectionHotspotContextKey("desktop_restart_recovery_residue", "trace-top", "wg-top", "task-top", "dispatch-top"): {
					SignalCode:    "desktop_restart_recovery_residue",
					TraceID:       "trace-top",
					WorkgroupID:   "wg-top",
					TaskID:        "task-top",
					DispatchRunID: "dispatch-top",
					LogCount:      1,
				},
			},
		},
	}, 6)

	if len(items) != 1 {
		t.Fatalf("expected 1 hotspot, got %d", len(items))
	}

	item := items[0]
	if item.TopTaskID != "task-top" {
		t.Fatalf("expected independent top task to remain task-top, got %+v", item)
	}
	if item.ReplaySignalCode != "desktop_resume_catchup_stalled" ||
		item.ReplayTraceID != "trace-grouped" ||
		item.ReplayWorkgroupID != "wg-grouped" ||
		item.ReplayTaskID != "task-grouped" ||
		item.ReplayDispatchRunID != "dispatch-grouped" {
		t.Fatalf("expected grouped replay context, got %+v", item)
	}
}
