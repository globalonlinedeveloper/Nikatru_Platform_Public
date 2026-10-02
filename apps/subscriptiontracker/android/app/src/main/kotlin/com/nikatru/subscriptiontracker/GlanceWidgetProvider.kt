package com.nikatru.subscriptiontracker

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.SharedPreferences
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import es.antonborri.home_widget.HomeWidgetLaunchIntent
import es.antonborri.home_widget.HomeWidgetProvider

/**
 * XP-04 · the home-screen glance. It READS what the app wrote on its last sync
 * (packages/widgets GlanceSnapshot.toWidgetData, the key set its test pins) and
 * never touches the network or the session: a widget process has neither.
 *
 * ADR 101: a Free snapshot carries no figures, only the Pro prompt, so this
 * provider has nothing to hide — it renders what it was given.
 */
class GlanceWidgetProvider : HomeWidgetProvider() {
    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
        widgetData: SharedPreferences,
    ) {
        val locked = widgetData.getString("glance_locked", "1") == "1"
        // The deep link is one of the routes the app accepts from a widget;
        // the Dart side re-checks it against its closed set before routing.
        val link = widgetData.getString("glance_link", "/home") ?: "/home"
        for (id in appWidgetIds) {
            val views = RemoteViews(context.packageName, R.layout.glance_widget)
            if (locked) {
                views.setViewVisibility(R.id.glance_facts, View.GONE)
                views.setViewVisibility(R.id.glance_prompt, View.VISIBLE)
                views.setTextViewText(R.id.glance_prompt, widgetData.getString("glance_prompt", ""))
            } else {
                views.setViewVisibility(R.id.glance_facts, View.VISIBLE)
                views.setViewVisibility(R.id.glance_prompt, View.GONE)
                views.setTextViewText(R.id.glance_fact0_label, widgetData.getString("glance_fact0_label", ""))
                views.setTextViewText(R.id.glance_fact0_value, widgetData.getString("glance_fact0_value", ""))
                views.setTextViewText(R.id.glance_fact1_label, widgetData.getString("glance_fact1_label", ""))
                views.setTextViewText(R.id.glance_fact1_value, widgetData.getString("glance_fact1_value", ""))
            }
            views.setOnClickPendingIntent(
                R.id.glance_root,
                HomeWidgetLaunchIntent.getActivity(
                    context,
                    MainActivity::class.java,
                    Uri.parse("subly-widget://open").buildUpon()
                        .appendQueryParameter("route", link)
                        .build(),
                ),
            )
            appWidgetManager.updateAppWidget(id, views)
        }
    }
}
