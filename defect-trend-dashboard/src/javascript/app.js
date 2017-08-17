/**
** 8/16/2017 Linda Taylor
** Bug fixes
** Report queries  will return the original creation date as well as the creation date. For each defect the report
** calculations will use the defect's original creation date. If there is no original creation, the calculation will
** the defect's creation date.
**
** States to consider closed will now default to values of ['Closed', 'Deferred', 'Rejected', 'Fixed'].
**
** Defect from closed projects will no longer get added to the count when the report is run by administrators. Queries
** use the "__PROJECT_OIDS_IN_SCOPE__" (hangman variable) work around to filter projects that are open.
**
** All charts and the defect accumulation drilldown will now use settings from the "Include Priorities" dropdown  picker.
**
** Unused  (commented out) code and unused variables were removed.
**
** Removed unused _makeDeltaChart function.
*/

Ext.define("TSDefectTrendDashboard", {
    extend: 'CA.techservices.app.ChartApp',

    
    descriptions: [
        "<strong>Defect Accumulation</strong><br/>" +
        "<br/>" +
        "What is the defect trend over time? " +
        "This chart shows the trend of creating and closing defects over time." +
        "<p/>" + 
        "Use the priorities drop-down box to determine which defect priorities to " +
        "display.  If nothing is chosen, the app will display all defects regardless " +
        "of priority.  Keep in mind that if filtering on priority, then the data line " +
        "will count the items in the proper state and with that priority on the day of each " +
        "point.  For example, if you choose High priority, a defect created on Monday as Low " +
        "priority but set to High on Wednesday won't get counted on the chart until Wednesday. " +
        "<p/>",
        
        "<strong>Open Defect Aging (Days Open) by Priority</strong><br/>" +
        "<br/>" +
        "How long have things been open? " +
        "This chart shows the number of defects by how long they've been open. " +
        "Each bar represents a range of day counts and the number is the number of defects that are " +
        "currently open and how long it has been since they were created.  The bar is segmented by priority." +
        "<p/>" + 
        "This chart shows all priorities. " +
        "<p/>",


        "<strong>Defect Closure Durations by Priority</strong><br/>" +
        "<br/>" +
        "How long do things stay open before closure? " +
        "This chart shows the number of defects by how long they were open before closing. " +
        "Each bar represents a range of day counts and the number is the number of defects that are " +
        "currently open and how long it has been since they were created.  The bar is segmented by priority." +
        "<p/>" + 
        "This chart shows all priorities. " +
        "<p/>"
        
    ],
    
    integrationHeaders : {
        name : "TSDefectTrendDashboard"
    },

    //Default settings for getSettingsFields - app setting dialog screen
    config: {
        defaultSettings: {
            showPatterns: false,
            closedStateValues: ['Closed', 'Deferred', 'Rejected', 'Fixed']
        }
    },

    
    priorities:null,
    granularity: 'month',
    timebox_limit: 5,
    all_priorities: [],
    
    launch: function() {
        this.callParent();

        // Work around to keep closed projects from being added in the counts when running as an administrator
        var openProjects = "__PROJECT_OIDS_IN_SCOPE__".split(",");
        this.scopedProjects = openProjects.map(Number);
        //this.logger.log("Scoped projects", this.scopedProjects);

        var closedStates = this.getSetting('closedStateValues');
        if ( Ext.isArray(closedStates) ) { closedStates = closedStates.join(', '); }
                
        this.descriptions[0] += "<strong>Notes:</strong><br/>" + 
            "<ul>" +
            "<li>States that count as 'Closed' (can be set by administrator): " + closedStates + "</li>" +
            "</ul>";
                
        this.applyDescription(this.descriptions[0],0);
        
        TSUtilities.getAllowedValues('Defect','Priority').then({
            scope: this,
            success: function (priorities) {
                // All priorities used to reset the priorities
                this.all_priorities = priorities;        
                this.priorities = priorities;        
                this._addSelectors();
                this._updateData();
            },
            failure: function(msg) {
                Ext.Msg.alert("Problem reading priorities", msg);
            }
        });
    },

    _addSelectors: function() {

        this.addToBanner({
            xtype: 'tsmultifieldvaluepicker',
            model: 'Defect',
            field: 'Priority',
            margin: 10,
            fieldLabel: 'Include Priorities:',
            labelWidth: 95,
            listeners:{
                blur:function(picker){
                    this.priorities = Ext.Array.map(picker.getValue(), function (value) {
                        return value.get('StringValue')
                    });

                    // A priority of "" coresponds to the "No entry" selection". It's not always in the first position
                    if (this.priorities === null || this.priorities.length === 0 || this.priorities.indexOf("") >=0 ) {
                        this.priorities = this.all_priorities;
                    }
                    this._updateData();
                },
                scope:this
            }
        });
        
        var granularity_store = Ext.create('Rally.data.custom.Store',{
            data:[
                { value:'month', display: 'Month' },
                { value:'quarter', display: 'Quarter' },
                { value:'day', display: 'Day' }
            ]
        });
        
        this.addToBanner({
            xtype:'rallycombobox',
            store: granularity_store,
            displayField:'display',
            valueField:'value',
            margin: 10,
            fieldLabel: 'Timebox Granularity:',
            labelWidth: 115,
            listeners: {
                select: function(cb) {
                    this.granularity = cb.getValue();
                    this._updateData();
                },
                scope: this
            }
        });
        
        this.addToBanner({
            xtype: 'rallynumberfield',
            name: 'timeBoxLimit',
            itemId: 'timeBoxLimit',
            fieldLabel: 'Number of Timeboxes:',
            value: this.timebox_limit,
            minValue: 1,
            margin: 10,
            labelWidth: 135,
            width: 200,
            allowBlank: false,  // requires a non-empty value
            listeners:{
                change:function(nf){
                    this.timebox_limit = nf.value;
                    this._updateData();
                },
                scope:this
            }
        });
    },
    
    _updateData: function() {
        
        Deft.Chain.pipeline([
            this._makeAccumulationChart,
            this._makeDefectAgingChart,
            this._makeDefectOpenTimeChart
        ],this).then({
            scope: this,
            success: function(results) {
                //Chart have been displayed do nothing else
            },
            failure: function(msg) {
                Ext.Msg.alert('--', msg);
            }
        });
    },
    
    _makeAccumulationChart: function () {
        var me = this;
        var closedStates = this.getSetting('closedStateValues');     
        if (!Ext.isArray(closedStates)) {
            closedStates = closedStates.split(/,/);
        }
        this.setChartLoading(0,"Loading");
        
        this.setChart({
            xtype: 'rallychart',
            storeType: 'Rally.data.lookback.SnapshotStore',
            storeConfig: this._getChartStoreConfig(),
            
            calculatorType: 'CA.techservices.calculator.DefectAccumulation',
            calculatorConfig: {
                closedStateValues: closedStates,
                allowedPriorities: this.priorities,
                granularity: this.granularity,
                endDate: new Date(),
                timeboxCount: this.timebox_limit
            },
            
            chartConfig: this._getAccumulationChartConfig(),
            chartColors: [CA.apps.charts.Colors.red, CA.apps.charts.Colors.green, CA.apps.charts.Colors.blue_light],
            listeners: {
                chartRendered: function() {
                    me.setChartLoading(0,false);
                }
            }
        }, 0);
    },
    
    _makeDefectOpenTimeChart: function() {
        var me = this;
        var closedStates = this.getSetting('closedStateValues');
        if ( !Ext.isArray(closedStates) ) { closedStates = closedStates.split(/,/); }
        
        var colors = CA.apps.charts.Colors.getConsistentBarColors();
                
        if ( this.getSetting('showPatterns') ) {
            colors = CA.apps.charts.Colors.getConsistentBarPatterns();
        }
        
        me.setChartLoading(2,"Loading...");

        this.setChart({
            xtype: 'rallychart',
            storeType: 'Rally.data.lookback.SnapshotStore',
            storeConfig: this._getChartStoreConfig(),
            
            calculatorType: 'CA.TechnicalServices.calculator.DefectResponseTimeCalculator',
            calculatorConfig: {
                closedStateValues: closedStates,
                granularity: 'day',
                buckets: this._getBucketRanges(),
                allowedPriorities: this.all_priorities,
                onPointClick: this.showClosureDrillDown
            },
            
            chartConfig: this._getClosureChartConfig(),
            chartColors: colors,
            listeners: {
                chartRendered: function() {
                    me.setChartLoading(2,false);
                }
            }
        },2);
    },
    
    _makeDefectAgingChart: function() {
        var me = this;
        var closedStates = this.getSetting('closedStateValues');
            
        if ( !Ext.isArray(closedStates) ) { closedStates = closedStates.split(/,/); }
        
        this._fetchOpenDefects(closedStates).then({
            scope: this,
            success: function(defects) {
                Ext.Array.each(defects, function(defect){
                    defect.set('__age', me._getAge(defect));
                });

                var defects_by_age = this._collectDefectsByAge(defects);
                var categories = Ext.Object.getKeys(defects_by_age);
                var series = this._getAgingSeries(defects_by_age);
                var colors = CA.apps.charts.Colors.getConsistentBarColors();
        
                if ( this.getSetting('showPatterns') ) {
                    colors = CA.apps.charts.Colors.getConsistentBarPatterns();
                }
                this.setChart({
                    chartData: { series: series, categories: categories },
                    chartConfig: this._getAgingChartConfig(),
                    chartColors: colors
                },1);
                this.setLoading(false);
                
            },
            failure: function(msg) {
                deferred.reject(msg);
            }
        });
    },
    
    _fetchOpenDefects: function(closed_states) {
        var filters = Ext.Array.map(closed_states, function(state){
            return {property:'State', operator: '!=', value: state}
        });
        
        var config = {
            model: 'Defect',
            limit: Infinity,
            filters: filters,
            fetch: ['FormattedID','Name','ScheduleState','Iteration','Release','ObjectID',
                'PlanEstimate','Project','State','CreationDate','c_OriginalCreationDate','Priority']
        };
        return TSUtilities.loadWsapiRecords(config);
    },
    
    _getAge: function (item) {
        var creationDate = item.get('c_OriginalCreationDate') != null ? item.get('c_OriginalCreationDate') : item.get('CreationDate');
        return Rally.util.DateTime.getDifference(new Date(), creationDate, 'day');
    },
    
    _getBucketRanges: function() {
        return {
            "0-14 Days":  0,
            "15-30 Days": 15,
            "31-60 Days": 31,
            "61-90 Days": 61,
            "91-200 Days": 91,
            "201-300 Days": 201,
            "301+ Days": 301
        };
    },
    
    _collectDefectsByAge: function(defects) {
        
        var bucket_ranges = this._getBucketRanges();
        var buckets = {};

        Ext.Object.each(bucket_ranges, function(key, value){
            buckets[key] = { "all": [] };

            Ext.Array.each(this.all_priorities, function (priority) {
                if (priority == "") {
                    priority = "None";
                }
                buckets[key][priority] = [];
            }
            );
        },this);
        
        Ext.Array.each(defects, function(defect){
            var age = defect.get('__age');
            var priority = defect.get('Priority');
            var bucket_choice = null;
            Ext.Object.each( bucket_ranges, function( key, value ) {
                if ( age >= value ) {
                    bucket_choice = key;
                }
            });

            buckets[bucket_choice]["all"].push(defect);
            if (buckets[bucket_choice][priority]) {
                buckets[bucket_choice][priority].push(defect);
            }          
        });
        
        return buckets;
        
    },
    
    _pushIntoBuckets: function(buckets, name, priority, item) {
        buckets[name].all.push(item);
        buckets[name][priority].push(item); 
        return buckets;
    },
    
    _getAgingSeries: function(defects_by_age){
        var me = this;
        var series = [];
        var priorities = this.all_priorities;

        Ext.Array.each(priorities, function (priority) {
            if (priority == "") {
                priority = "None";
            }
            
            series.push({
                name: priority,
                data: me._calculateAgingMeasures(defects_by_age, priority),
                type:'column',
                stack: 'a'
            });
        });
        
        return series;
    },
    
    _calculateAgingMeasures: function(defects_by_age,priority) {
        var me = this;
        var data = [];
            
        Ext.Object.each(defects_by_age, function(bucket,value){
            data.push({
                y: value[priority].length,
                _records: value.all,
                events: {
                    click: function() {
                        me.showDrillDown(this._records, bucket);
                    }
                }
            });
        });
        
        return data;
    },
    
    _getAgingChartConfig: function() {
        return {
            chart: { type:'column' },
            title: { text: 'Open Defect Aging (Days Open)' },
            xAxis: {},
            yAxis: [{ 
                title: { text: 'Open Defects' }
            }],
            plotOptions: {
                column: {
                    stacking: 'normal'
                }
            },
            tooltip: {
                formatter: function() {
                    return '<b>'+ this.series.name +'</b>: '+ Ext.util.Format.number(this.point.y, '0.##');
                }
            }
        }
    },
    
    _getChartStoreConfig: function() {     
        var granularity = this.granularity; 
        var count = -1 * this.timebox_limit;
        if (granularity === "quarter") {
            granularity = "month";
            count = 3 * count;
        }
        var start_date = Rally.util.DateTime.toIsoString(
            Rally.util.DateTime.add(new Date(), granularity, count)
        );
        
        return {
            find: {
                _TypeHierarchy: 'Defect',
                _ProjectHierarchy: this.getContext().getProject().ObjectID,
                "$or": [
                    { _ValidFrom: { "$gte": start_date } },
                    { __At: start_date }
                ],
                Project: {
                    "$in": this.scopedProjects
                }
           },
           removeUnauthorizedSnapshots: true,
           fetch: ['ObjectID','State','Priority','CreationDate','c_OriginalCreationDate','FormattedID','Name'],
           hydrate: ['State','Priority'],
           sort: {
               '_ValidFrom': 1
           }
        };
    },
    
    _getTickInterval: function(granularity) {
        if (Ext.isEmpty(granularity)) {
            return 30;
        }
        
        
        granularity = granularity.toLowerCase();
        if (this.timebox_limit < 30) {
            return 1;
        }
        if (granularity === 'day') {
            return 30;
        }
        
        return 1;
        
    },
    
    _getAccumulationChartConfig: function() {
        return {
            chart: {
                zoomType: 'xy'
            },
            title: {
                text: 'Defect Accumulation'
            },
            xAxis: {
                tickmarkPlacement: 'on',
                tickInterval: this._getTickInterval(this.granularity),
                title: {
                    text: 'Date'
                },
                labels            : {
                    rotation : -45
                }
            },
            yAxis: [
                {
                    min: 0,
                    title: {
                        text: 'Total Defects (cumulative)'
                    }
                },
                {
                    min: 0,
                    title: {
                        text: 'Total Defects'
                    },
                    opposite: true
                }
            ],
            tooltip: { shared: true },
            plotOptions: {
                series: {
                    marker: {
                        enabled: false
                    }
                },
                area: {
                    stacking: 'normal'
                }
            }
        };
    },
    
    _getDeltaChartConfig: function() {
        return {
            chart: {
                zoomType: 'xy'
            },
            title: {
                text: ''
            },
            xAxis: {
                tickmarkPlacement: 'on',
                tickInterval: this._getTickInterval(this.granularity),
                title: {
                    text: 'Date'
                },
                labels            : {
                    rotation : -45
                }
            },
            yAxis: [
                {
                    min: 0,
                    title: {
                        text: 'Total Open Defects'
                    }
                }
            ],
            tooltip: { shared: true },
            plotOptions: {
                series: {
                    marker: {
                        enabled: false
                    }
                },
                area: {
                    stacking: 'normal'
                }
            }
        };
    },
    
    _getClosureChartConfig: function() {
        return {
            chart: {
                zoomType: 'xy'
            },
            title: {
                text: 'Defect Closure Durations by Priority'
            },
            xAxis: {
                tickmarkPlacement: 'on',
                title: {
                    text: ''
                }
            },
            yAxis: [
                {
                    min: 0,
                    title: {
                        text: 'Days to Close'
                    }
                }
            ],
            tooltip: { shared: true },
            plotOptions: {
                series: {
                    marker: {
                        enabled: false
                    }
                },
                column: {
                    stacking: 'normal'
                }
            }
        };
    },

    // populate the app's settings dialog screen
    getSettingsFields: function() {
        var left_margin = 5;
        return [{
            name: 'closedStateValues',
            xtype: 'tsmultifieldvaluepicker',
            model: 'Defect',
            field: 'State',
            margin: left_margin,
            fieldLabel: 'States to Consider Closed',
            labelWidth: 150
        },
        
        { 
            name: 'showPatterns',
            xtype: 'rallycheckboxfield',
            boxLabelAlign: 'after',
            fieldLabel: '',
            margin: '0 0 225 ' + left_margin,
            boxLabel: 'Show Patterns<br/><span style="color:#999999;"><i>Tick to use patterns in the chart instead of color.</i></span>'
        }];
    },
    
    getDrillDownColumns: function(title) {
        var columns = [
            {
                dataIndex : 'FormattedID',
                text: "id",
                flex:1
            },
            {
                dataIndex : 'Name',
                text: "Name",
                flex: 2
            },
            {
                dataIndex: 'CreationDate',
                text: 'Created'
            },
            {
                dataIndex: '__age',
                text: 'Age (Days)'
            },
            { 
                dataIndex: 'Priority',
                text: 'Priority'
            },
            {
                dataIndex: 'State',
                text: 'State'
            },
            {
                dataIndex: 'Project',
                text: 'Project',
                renderer:function(Project){
                        return Project.Name;
                },
                flex: 1
            }
        ];
        
        if ( /\(multiple\)/.test(title)) {
            columns.push({
                dataIndex: 'Name',
                text: 'Count of Moves',
                renderer: function(value, meta, record) {
                    
                    return value.split('[Continued]').length;
                }
            });
        }
        
        
        return columns;
    },

    _getEndOfMonth: function (point_date) {
        // Fix calculation quirk in fromIsoString by adjusting for US Eastern Standard time.
        var jsdate = Rally.util.DateTime.fromIsoString(point_date + "-01T05:00:00Z");
        var shifted_date = Rally.util.DateTime.add(jsdate, 'month', 1);

        if (shifted_date > new Date()) {
            shifted_date = new Date();
        } else {
            shifted_date = Rally.util.DateTime.add(shifted_date, 'day', -1);
        }

        return Rally.util.DateTime.toIsoString(shifted_date).replace(/T.*$/, '');
    },
    
    _getDateFromPoint: function(point) {
        var point_date = point.category;

        if (this.granularity === "month") {
            //Expecting category in form yyyy-mm
            point_date = this._getEndOfMonth(point_date);

        } else if (this.granularity === "quarter") {
            //Expecting input category like 2017Q3 - Find last day of quarter
            var year = point_date.replace(/Q.*$/, '');
            var quarter = parseInt(point_date.replace(/.*Q/, ''), 10);
            var month = ("0" + (quarter * 3)).slice(-2);


            point_date = this._getEndOfMonth(year + "-" + month);
        }
        return point_date;
    },
    
    showClosureDrillDown: function(point) {
        var store = Ext.create('Rally.data.custom.Store',{
            data: point.__all_records || []
        });
        var columns = [
            {dataIndex:'FormattedID',text:'id'},
            {dataIndex:'Name',text:'Name',flex:1},
            {dataIndex:'State',text:'State'},
            {dataIndex:'Priority',text:'Priority'},
            {dataIndex:'__cycle', text:'Time to Close (Days)', flex: 1, renderer: function(value,meta,record){
                if ( Ext.isEmpty(value) ){ return ""; }
                return Ext.util.Format.number(value,'0.0');
            }}
        ];
        
        Ext.create('Rally.ui.dialog.Dialog', {
            id        : 'detailPopup',
            title     : point.category,
            width     : Ext.getBody().getWidth() - 50,
            height    : Ext.getBody().getHeight() - 50,
            closable  : true,
            layout    : 'border',
            items     : [{
                xtype                : 'rallygrid',
                region               : 'center',
                layout               : 'fit',
                sortableColumns      : true,
                showRowActionsColumn : false,
                showPagingToolbar    : true,
                columnCfgs           : columns,
                store : store
            }]
        }).show();
    },
    
    showTrendDrillDown: function(point) {
        var iso_date = this._getDateFromPoint(point);

        var filters = [
            {property: '_TypeHierarchy',value:'Defect'},
            {property: '__At',value:iso_date},
            {property: '_ProjectHierarchy', value: this.getContext().getProject().ObjectID },
            {property: 'Project', value: { '$in': this.scopedProjects } },
            {property: 'Priority', value: { '$in': this.priorities } }
        ];
                
        var config = {
            fetch: ['FormattedID','Name','State','Priority'],
            filters: filters,
            hydrate: ['Priority','State'],
            autoLoad: true
        };
        
        TSUtilities.loadLookbackRecords(config).then({
            scope: this,
            failure: function(msg) {
                Ext.Msg.alert("Problem loading Drill Down",msg);
            },
            success: function(records) {
                // loading into custom store because the snapshot store and
                // column combination isn't allowing us to put anything into
                // the FOrmattedID column, even though we have the data.
                var store = Ext.create('Rally.data.custom.Store',{
                    data: records
                });
                var columns = [
                    {dataIndex:'FormattedID',text:'id'},
                    {dataIndex:'Name',text:'Name',flex:1},
                    {dataIndex:'State',text:'State'},
                    {dataIndex:'Priority',text:'Priority', flex: 1}
                ];
 
                Ext.create('Rally.ui.dialog.Dialog', {
                    id        : 'detailPopup',
                    title     : 'Defects on ' + iso_date,
                    width     : Ext.getBody().getWidth() - 50,
                    height    : Ext.getBody().getHeight() - 50,
                    closable  : true,
                    layout    : 'border',
                    items     : [{
                        xtype                : 'rallygrid',
                        region               : 'center',
                        layout               : 'fit',
                        sortableColumns      : true,
                        showRowActionsColumn : false,
                        showPagingToolbar    : true,
                        columnCfgs           : columns,
                        store : store
                    }]
                }).show();
            }
        });
    }    

});
